// Registro de cada refeição, feito no /admin por quem está no bandejão: o sabor do suco (a API
// da USP só diz "Suco") e as saladas do dia (ela só diz "Saladas: Diversas").
// Um hash por restaurante, mbp:registro:<id>, com um campo por refeição ("dd/mm/aaaa|lunch") →
// {"suco":{"sabores":"uva/melancia","at":"<ISO>"},"saladas":{"itens":["escarola","tomate"],"at":"<ISO>"}}
import { pipeline } from './store.js';
import { DISHES } from '../public/nutrition.js';
import './receitas.js'; // as saladas vindas do cartaz entram em DISHES

const P = 'mbp:registro:';
const MEALS = ['lunch', 'dinner'];

export const validRestaurant = (id) => /^\d{1,3}$/.test(String(id ?? ''));

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

// suco: texto (vazio apaga); saladas: lista de chaves de salada (vazia apaga, e o app volta para
// "Saladas diversas"). O que não vier no pedido fica como está.
export async function saveRegistro({ restaurant, date, meal, suco, saladas }) {
  if (!validRestaurant(restaurant)) throw new Error('restaurante inválido');
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(String(date ?? ''))) throw new Error('data inválida (use dd/mm/aaaa)');
  if (!MEALS.includes(meal)) throw new Error('refeição inválida');
  const key = `${P}${restaurant}`;
  const field = `${date}|${meal}`;
  const [raw] = await pipeline([['HGET', key, field]]);
  let reg = {};
  try { reg = raw ? JSON.parse(raw) : {}; } catch { /* estragado: recomeça */ }
  const at = new Date().toISOString();
  if (suco !== undefined) {
    const sabores = normalizeSabores(suco);
    if (sabores) reg.suco = { sabores, at }; else delete reg.suco;
  }
  if (saladas !== undefined) {
    const itens = normalizeSaladas(saladas);
    if (itens.length) reg.saladas = { itens, at }; else delete reg.saladas;
  }
  if (!reg.suco && !reg.saladas) await pipeline([['HDEL', key, field]]);
  else await pipeline([['HSET', key, field, JSON.stringify(reg)]]);
  return reg;
}
