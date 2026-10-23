// Reports dos usuários: "este prato mudou lá no bandejão". Cada navegador conta uma vez por prato,
// e só vale para a refeição de hoje. A partir de REPORT_MIN pessoas o /admin destaca o report; ao
// aprovar, o admin escreve o motivo (e, se quiser, o prato que entrou no lugar) e isso vira um aviso
// no app (lib/registro.js → avisos).
//   mbp:reports              → hash, campo "<rest>|<dd/mm/aaaa>|<meal>|<grupo>|<prato normalizado>" →
//                              {"restaurant","date","meal","grupo","item","n","primeiro","ultimo","sugestoes":{"frango":2}}
//   mbp:reports:vids:<campo> → set dos navegadores que reportaram (expira em 3 dias)
import { pipeline } from './store.js';
import { norm } from '../public/nutrition.js';
import { GRUPOS, addAviso, todaySP, validMeal } from './registro.js';

export const REPORT_MIN = 10;
const H = 'mbp:reports';
const vidsKey = (field) => `${H}:vids:${field}`;
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const parse = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };

export async function addReport({ restaurant, date, meal, grupo, item, vid, texto }) {
  validMeal({ restaurant, date, meal });
  if (!GRUPOS.includes(grupo)) throw new Error('grupo inválido');
  if (date !== todaySP()) throw new Error('só dá para avisar sobre a refeição de hoje');
  if (!/^[0-9a-f-]{16,40}$/i.test(String(vid ?? ''))) throw new Error('navegador sem identificação');
  const nome = clip(item, 120);
  if (!nome) throw new Error('falta o prato');
  const sugestao = clip(texto, 80).toLowerCase();
  const field = [restaurant, date, meal, grupo, norm(nome)].join('|');
  const [added] = await pipeline([['SADD', vidsKey(field), vid], ['EXPIRE', vidsKey(field), 3 * 86400]]);
  const [n, raw] = await pipeline([['SCARD', vidsKey(field)], ['HGET', H, field]]);
  const at = new Date().toISOString();
  const r = parse(raw) ?? { restaurant: String(restaurant), date, meal, grupo, item: nome, primeiro: at, sugestoes: {} };
  r.n = Number(n);
  r.ultimo = at;
  // cada pessoa sugere uma vez (na primeira vez que avisa); guarda no máximo 10 sugestões diferentes
  if (sugestao && Number(added) === 1 && (r.sugestoes[sugestao] || Object.keys(r.sugestoes).length < 10)) {
    r.sugestoes[sugestao] = (r.sugestoes[sugestao] || 0) + 1;
  }
  await pipeline([['HSET', H, field, JSON.stringify(r)]]);
  return { n: r.n, novo: Number(added) === 1 };
}

// reports em aberto, mais avisados primeiro; os de mais de 2 dias são apagados aqui
export async function listReports() {
  const [flat] = await pipeline([['HGETALL', H]]);
  const keep = new Set([todaySP(), todaySP(-1), todaySP(-2)]);
  const out = [];
  const old = [];
  for (let i = 0; i < (flat?.length || 0); i += 2) {
    const r = parse(flat[i + 1]);
    if (r && keep.has(r.date)) out.push({ field: flat[i], ...r });
    else old.push(flat[i]);
  }
  if (old.length) await pipeline([['HDEL', H, ...old], ...old.map((f) => ['DEL', vidsKey(f)])]);
  return out.sort((a, b) => b.n - a.n || String(b.ultimo).localeCompare(String(a.ultimo)));
}

export async function dropReport(field) {
  await pipeline([['HDEL', H, String(field)], ['DEL', vidsKey(field)]]);
}

// aprovar = virar aviso no app, com o motivo (e o prato novo, se houver) escritos pelo admin
export async function approveReport({ field, novo, motivo }) {
  const [raw] = await pipeline([['HGET', H, String(field)]]);
  const r = parse(raw);
  if (!r) throw new Error('report não encontrado (já foi aprovado ou descartado?)');
  const registro = await addAviso({ ...r, novo, motivo, pessoas: r.n, tipo: 'report' });
  await dropReport(field);
  return registro;
}
