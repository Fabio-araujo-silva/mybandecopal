// Registro de cada refeição: o que se sabe além do texto da API da USP.
//   suco     — sabor, registrado no /admin por quem está no bandejão (a API só diz "Suco")
//   saladas  — saladas do dia, marcadas no /admin (a API só diz "Saladas: Diversas")
//   avisos   — pratos que mudaram lá na hora: aprovados a partir dos reports dos usuários
//              (lib/reports.js) ou marcados pelo admin, com motivo e/ou o prato que entrou no lugar
//   mudancas — mudanças que a própria USP fez no cardápio, detectadas pelo cache (lib/uspcache.js)
// Um hash por restaurante, mbp:registro:<id>, com um campo por refeição ("dd/mm/aaaa|lunch") →
// {"suco":{"sabores":"uva/melancia","at":"<ISO>"},"saladas":{"itens":["escarola","tomate"],"at":"<ISO>"},
//  "avisos":[{"tipo":"report","grupo":"prato","item":"…","novo":"…","motivo":"…","pessoas":12,"at":"<ISO>"}],
//  "mudancas":[{"at":"<ISO>","itens":[{"grupo":"guarnicao","de":["Purê"],"para":["Batata sauté"]}]}]}
import { pipeline } from './store.js';
import { DISHES, norm, parseMenu } from '../public/nutrition.js';
import './receitas.js'; // as saladas vindas do cartaz entram em DISHES

const P = 'mbp:registro:';
const MEALS = ['lunch', 'dinner'];
export const GRUPOS = ['prato', 'guarnicao', 'sobremesa']; // o que pode ter aviso de mudança
const GRUPOS_USP = ['prato', 'guarnicao', 'salada', 'sobremesa']; // o que se compara nas mudanças da USP
const LOG = 'mbp:mudancas:log'; // últimas mudanças da USP, de todos os restaurantes, para o /admin

export const validRestaurant = (id) => /^\d{1,3}$/.test(String(id ?? ''));

export function validMeal({ restaurant, date, meal }) {
  if (!validRestaurant(restaurant)) throw new Error('restaurante inválido');
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(String(date ?? ''))) throw new Error('data inválida (use dd/mm/aaaa)');
  if (!MEALS.includes(meal)) throw new Error('refeição inválida');
}

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// "Uva e Melancia", "uva, melancia", "uva/melancia" → "uva/melancia"
export function normalizeSabores(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .split(/\s*(?:\/|,|;|\+|\be\b)\s*/)
    .map((s) => s.replace(/\s+/g, ' ').trim().slice(0, 30))
    .filter(Boolean)
    .slice(0, 4)
    .join('/');
}

function normalizeSaladas(list) {
  if (!Array.isArray(list)) throw new Error('saladas deve ser uma lista');
  const keys = [...new Set(list.map(String))];
  const bad = keys.filter((k) => DISHES[k]?.kind !== 'salada');
  if (bad.length) throw new Error(`salada desconhecida: ${bad.join(', ')}`);
  return keys.slice(0, 12);
}

export async function readRegistros(restId) {
  if (!validRestaurant(restId)) throw new Error('id de restaurante inválido');
  const [flat] = await pipeline([['HGETALL', `${P}${restId}`]]);
  const out = {};
  for (let i = 0; i < (flat?.length || 0); i += 2) {
    try { out[flat[i]] = JSON.parse(flat[i + 1]); } catch { /* registro estragado: ignora */ }
  }
  return out;
}

// lê, muda e grava o registro de uma refeição (campos vazios somem; registro vazio é apagado)
async function update(restaurant, date, meal, change) {
  const key = `${P}${restaurant}`;
  const field = `${date}|${meal}`;
  const [raw] = await pipeline([['HGET', key, field]]);
  let reg = {};
  try { reg = raw ? JSON.parse(raw) : {}; } catch { /* estragado: recomeça */ }
  change(reg);
  for (const k of Object.keys(reg)) if (reg[k] == null || (Array.isArray(reg[k]) && !reg[k].length)) delete reg[k];
  if (!Object.keys(reg).length) await pipeline([['HDEL', key, field]]);
  else await pipeline([['HSET', key, field, JSON.stringify(reg)]]);
  return reg;
}

// suco: texto (vazio apaga); saladas: lista de chaves de salada (vazia apaga, e o app volta para
// "Saladas diversas"). O que não vier no pedido fica como está.
export async function saveRegistro({ restaurant, date, meal, suco, saladas }) {
  validMeal({ restaurant, date, meal });
  const itens = saladas !== undefined ? normalizeSaladas(saladas) : undefined;
  const at = new Date().toISOString();
  return update(restaurant, date, meal, (reg) => {
    if (suco !== undefined) {
      const sabores = normalizeSabores(suco);
      reg.suco = sabores ? { sabores, at } : null;
    }
    if (itens !== undefined) reg.saladas = itens.length ? { itens, at } : null;
  });
}

// Aviso de prato que mudou lá na hora: tipo "report" (aprovado a partir dos reports, com quantas
// pessoas avisaram) ou "admin" (marcado direto). Um aviso por prato: marcar de novo substitui.
export async function addAviso({ restaurant, date, meal, grupo, item, novo, motivo, pessoas, tipo }) {
  validMeal({ restaurant, date, meal });
  if (!GRUPOS.includes(grupo)) throw new Error('grupo inválido (prato, guarnicao ou sobremesa)');
  const aviso = {
    tipo: tipo === 'report' ? 'report' : 'admin',
    grupo,
    item: clip(item, 120),
    novo: clip(novo, 120) || null,
    motivo: clip(motivo, 140) || null,
    pessoas: Number(pessoas) > 0 ? Number(pessoas) : null,
    at: new Date().toISOString(),
  };
  if (!aviso.item) throw new Error('falta o prato');
  if (!aviso.novo && !aviso.motivo) throw new Error('escreva o motivo ou o prato que entrou no lugar');
  return update(restaurant, date, meal, (reg) => {
    reg.avisos = [...(reg.avisos ?? []).filter((a) => norm(a.item) !== norm(aviso.item)), aviso];
  });
}

export async function removeAviso({ restaurant, date, meal, item }) {
  validMeal({ restaurant, date, meal });
  return update(restaurant, date, meal, (reg) => {
    reg.avisos = (reg.avisos ?? []).filter((a) => norm(a.item) !== norm(item));
  });
}

// O que mudou entre dois textos da mesma refeição, por grupo: [{ grupo, de: [...], para: [...] }].
// Diferença só de maiúscula, acento ou pontuação não conta. Cardápio que acabou de sair (antes
// vazio) não é mudança; refeição que fechou vira { grupo: 'refeicao', para: ['fechado'] }.
export function diffMeal(antes, depois) {
  const a = parseMenu(antes);
  const b = parseMenu(depois);
  if (a.closed) return [];
  if (b.closed) return [{ grupo: 'refeicao', de: [], para: ['fechado'] }];
  const out = [];
  for (const grupo of GRUPOS_USP) {
    const at = a.items.filter((it) => it.group === grupo).map((it) => it.text);
    const bt = b.items.filter((it) => it.group === grupo).map((it) => it.text);
    const an = new Set(at.map(norm));
    const bn = new Set(bt.map(norm));
    const de = at.filter((t) => !bn.has(norm(t)));
    const para = bt.filter((t) => !an.has(norm(t)));
    if (de.length || para.length) out.push({ grupo, de, para });
  }
  return out;
}

// Chamada pelo cache quando o cardápio de um restaurante mudou na USP: compara refeição por
// refeição (só datas que já existiam) e grava o que mudou, com a hora em que descobrimos.
export async function recordMudancas(restaurant, antigo, novo) {
  const at = new Date().toISOString();
  const old = new Map((antigo?.days ?? []).map((d) => [d.date, d]));
  const found = [];
  for (const day of novo?.days ?? []) {
    const prev = old.get(day.date);
    if (!prev) continue;
    for (const meal of MEALS) {
      const antes = prev[meal]?.menu ?? '';
      const depois = day[meal]?.menu ?? '';
      if (antes === depois) continue;
      const itens = diffMeal(antes, depois);
      if (itens.length) found.push({ date: day.date, meal, itens });
    }
  }
  for (const f of found) {
    await update(restaurant, f.date, f.meal, (reg) => {
      reg.mudancas = [...(reg.mudancas ?? []), { at, itens: f.itens }].slice(-5);
    });
  }
  if (found.length) {
    await pipeline([
      ...found.map((f) => ['LPUSH', LOG, JSON.stringify({ restaurant: String(restaurant), ...f, at })]),
      ['LTRIM', LOG, 0, 49],
    ]);
  }
  return found;
}

export async function readMudancasLog(n = 30) {
  const [list] = await pipeline([['LRANGE', LOG, 0, n - 1]]);
  return (list ?? []).map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
}

// hoje em São Paulo, dd/mm/aaaa
export function todaySP(offsetDays = 0) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' })
    .formatToParts(new Date(Date.now() + offsetDays * 86400000)).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year}`;
}
