// Estatísticas anônimas de uso para a página /admin.
// Cada navegador manda um id aleatório (não ligado a nenhuma pessoa); nenhum IP é guardado.
import { backend, pipeline } from './store.js';

const P = 'mbp:';
const DAY_TTL = 120 * 86400;
const ACTIVE_WINDOW_MS = 5 * 60 * 1000;

export function spDay(offsetDays = 0) {
  const d = new Date(Date.now() - offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d); // AAAA-MM-DD
}

const daily = (name, day = spDay()) => `${P}${name}:${day}`;
// chaves diárias (terminam em :AAAA-MM-DD) expiram sozinhas
const withTtl = (cmds) => cmds.flatMap((c) => (/:\d{4}-\d{2}-\d{2}$/.test(c[1]) ? [c, ['EXPIRE', c[1], DAY_TTL]] : [c]));

// ---------------------------------------------------------------- gravação

const clean = (s, max = 60) => String(s ?? '').slice(0, max).replace(/[^\p{L}\p{N} _.:>@|-]/gu, '');

export async function recordEvent(ev) {
  const vid = clean(ev.vid, 40);
  if (!/^[0-9a-f-]{16,40}$/i.test(vid)) return;
  const day = spDay();
  const now = Date.now();
  const cmds = [['ZADD', `${P}active`, now, vid]];
  const restaurant = /^\d{1,3}$/.test(ev.restaurant) ? ev.restaurant : null;
  const meal = ev.meal === 'lunch' || ev.meal === 'dinner' ? ev.meal : null;

  switch (ev.type) {
    case 'view': {
      cmds.push(['INCR', daily('pv', day)], ['PFADD', daily('uv', day), vid]);
      cmds.push(['HINCRBY', daily('dev', day), ev.device === 'mobile' ? 'mobile' : 'desktop', 1]);
      if (restaurant) cmds.push(['HINCRBY', daily('rest', day), restaurant, 1]);
      if (meal) cmds.push(['HINCRBY', daily('meal', day), meal, 1]);
      break;
    }
    case 'meal':
      if (restaurant) cmds.push(['HINCRBY', daily('rest', day), restaurant, 1]);
      if (meal) cmds.push(['HINCRBY', daily('meal', day), meal, 1]);
      break;
    case 'choice':
      cmds.push(['HINCRBY', `${P}choice`, `${clean(ev.group, 20)}:${clean(ev.value, 30)}`, 1]);
      break;
    case 'portion': {
      const dish = clean(ev.dish, 40);
      const grams = Number(ev.grams), def = Number(ev.def);
      if (!dish || !Number.isFinite(grams) || grams < 0 || grams > 3000) return;
      cmds.push(['HINCRBY', `${P}portion:n`, dish, 1], ['HINCRBYFLOAT', `${P}portion:g`, dish, grams]);
      if (Number.isFinite(def)) cmds.push(['HSET', `${P}portion:def`, dish, def]);
      break;
    }
    case 'swap':
      cmds.push(['HINCRBY', `${P}swap`, `${clean(ev.dish, 40)}>${Number(ev.taco) || 0}`, 1]);
      break;
    default:
      return;
  }
  const results = await pipeline(withTtl(cmds));
  // primeira visita deste navegador? (PFADD no conjunto geral devolve 1 quando o id é novo)
  if (ev.type === 'view') {
    const [isNew] = await pipeline([['PFADD', `${P}uv:all`, vid]]);
    if (Number(isNew) === 1) await pipeline(withTtl([['INCR', daily('new', day)]]));
  }
  return results;
}

// chamada pelo /api/menu a cada consulta à USP (no máximo 1 por hora por restaurante: lib/uspcache.js)
export async function recordUspFetch({ restaurant, ok, ms, error, generic = [] }) {
  const day = spDay();
  const at = new Date().toISOString();
  const cmds = [
    ['HINCRBY', daily('api', day), ok ? 'ok' : 'err', 1],
    ['HINCRBY', daily('api', day), 'ms', Math.round(ms)],
    ['SET', `${P}api:last`, JSON.stringify({ ok, ms: Math.round(ms), at, restaurant, error: error ?? null })],
  ];
  if (!ok) cmds.push(['LPUSH', `${P}api:errors`, JSON.stringify({ at, restaurant, error })], ['LTRIM', `${P}api:errors`, 0, 19]);
  for (const g of generic.slice(0, 30)) cmds.push(['HSET', `${P}generic`, clean(g.text, 80), `${at}|${restaurant}|${g.role}`]);
  await pipeline(withTtl(cmds));
}

// ---------------------------------------------------------------- avaliações (estrelas)
// Histograma por prato: hash mbp:rating:<chave> com campos "1".."5". A média se calcula dos campos.
// O navegador manda a nota anterior (prev) para corrigir o histograma quando a pessoa muda a nota,
// sem precisar de login. `cat` = proteina | guarnicao | sobremesa.

export async function recordRating({ key, label, cat, stars, prev }) {
  const k = clean(key, 80);
  const s = Number(stars);
  if (!k || !(s >= 1 && s <= 5)) return { ok: false };
  const cmds = [['HINCRBY', `${P}rating:${k}`, String(s), 1]];
  const p = Number(prev);
  if (p >= 1 && p <= 5 && p !== s) cmds.push(['HINCRBY', `${P}rating:${k}`, String(p), -1]);
  const category = ['proteina', 'guarnicao', 'sobremesa'].includes(cat) ? cat : 'outro';
  cmds.push(['HSET', `${P}rating:meta`, k, `${category}|${clean(label, 80)}`]);
  await pipeline(cmds);
  return { ok: true };
}

async function readRatings() {
  const [meta] = await pipeline([['HGETALL', `${P}rating:meta`]]);
  const metaMap = hash(meta);
  const dishKeys = Object.keys(metaMap);
  if (!dishKeys.length) return [];
  const hists = await pipeline(dishKeys.map((k) => ['HGETALL', `${P}rating:${k}`]));
  return dishKeys.map((k, i) => {
    const h = hash(hists[i]);
    let n = 0, sum = 0;
    // o navegador manda a nota anterior para corrigir o balde; se vier torto, nunca deixa negativo
    const dist = [1, 2, 3, 4, 5].map((s) => { const c = Math.max(0, Number(h[String(s)] || 0)); n += c; sum += c * s; return c; });
    const [cat, label] = String(metaMap[k]).split('|');
    return { key: k, label: label || k, cat: cat || 'outro', count: n, avg: n ? +(sum / n).toFixed(2) : 0, dist };
  }).filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------- leitura

const hash = (flat) => {
  const o = {};
  for (let i = 0; i < (flat?.length ?? 0); i += 2) o[flat[i]] = flat[i + 1];
  return o;
};
const sumInto = (acc, obj) => { for (const [k, v] of Object.entries(obj)) acc[k] = (acc[k] || 0) + Number(v); return acc; };

export async function readStats(days = 30) {
  const dates = Array.from({ length: days }, (_, i) => spDay(days - 1 - i));
  const now = Date.now();
  const cmds = [
    ['ZREMRANGEBYSCORE', `${P}active`, '-inf', now - ACTIVE_WINDOW_MS],
    ['ZCARD', `${P}active`],
    ['PFCOUNT', ...dates.slice(-7).map((d) => daily('uv', d))],
    ['PFCOUNT', ...dates.map((d) => daily('uv', d))],
    ['PFCOUNT', `${P}uv:all`],
    ['HGETALL', `${P}choice`],
    ['HGETALL', `${P}portion:n`],
    ['HGETALL', `${P}portion:g`],
    ['HGETALL', `${P}portion:def`],
    ['HGETALL', `${P}swap`],
    ['HGETALL', `${P}generic`],
    ['GET', `${P}api:last`],
    ['LRANGE', `${P}api:errors`, 0, 9],
  ];
  const head = cmds.length;
  for (const d of dates) {
    cmds.push(['PFCOUNT', daily('uv', d)], ['GET', daily('pv', d)], ['GET', daily('new', d)],
      ['HGETALL', daily('rest', d)], ['HGETALL', daily('meal', d)], ['HGETALL', daily('dev', d)], ['HGETALL', daily('api', d)]);
  }
  const r = await pipeline(cmds);

  const perDay = dates.map((date, i) => {
    const o = head + i * 7;
    return { date, visitors: Number(r[o]) || 0, views: Number(r[o + 1]) || 0, newVisitors: Number(r[o + 2]) || 0,
      rest: hash(r[o + 3]), meal: hash(r[o + 4]), dev: hash(r[o + 5]), api: hash(r[o + 6]) };
  });

  const restaurants = perDay.reduce((acc, d) => sumInto(acc, d.rest), {});
  const meals = perDay.reduce((acc, d) => sumInto(acc, d.meal), {});
  const devices = perDay.reduce((acc, d) => sumInto(acc, d.dev), {});
  const api7 = perDay.slice(-7).reduce((acc, d) => sumInto(acc, d.api), {});

  const n = hash(r[6]), gsum = hash(r[7]), def = hash(r[8]);
  const portions = Object.entries(n).map(([dish, count]) => ({
    dish, edits: Number(count), avgGrams: Math.round(Number(gsum[dish] || 0) / Number(count)), defaultGrams: def[dish] != null ? Number(def[dish]) : null,
  })).sort((a, b) => b.edits - a.edits);

  const generic = Object.entries(hash(r[10])).map(([text, v]) => {
    const [at, restaurant, role] = String(v).split('|');
    return { text, at, restaurant, role };
  }).sort((a, b) => b.at.localeCompare(a.at));

  const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
  const ratings = await readRatings();
  return {
    backend,
    ratings,
    generatedAt: new Date().toISOString(),
    activeNow: Number(r[1]) || 0,
    visitors7d: Number(r[2]) || 0,
    visitors30d: Number(r[3]) || 0,
    visitorsAllTime: Number(r[4]) || 0,
    today: perDay[perDay.length - 1],
    perDay: perDay.map(({ date, visitors, views, newVisitors }) => ({ date, visitors, views, newVisitors })),
    restaurants, meals, devices,
    choices: hash(r[5]),
    portions,
    swaps: Object.entries(hash(r[9])).map(([k, v]) => ({ key: k, count: Number(v) })).sort((a, b) => b.count - a.count),
    generic,
    usp: { last: parse(r[11]), errors: (r[12] ?? []).map(parse).filter(Boolean), ok7d: api7.ok || 0, err7d: api7.err || 0,
      avgMs: (api7.ok || 0) + (api7.err || 0) ? Math.round((api7.ms || 0) / ((api7.ok || 0) + (api7.err || 0))) : null },
  };
}
