// Armazenamento das estatísticas.
// Na Vercel: Redis do Upstash (integração do Marketplace), pela API REST — variáveis
// KV_REST_API_URL/KV_REST_API_TOKEN ou UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN.
// Sem elas: emulação em memória dos poucos comandos usados, gravada em .data/store.json
// quando dá para escrever em disco (uso local). Na Vercel sem Redis os dados não persistem.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const backend = url && token ? 'redis' : process.env.VERCEL ? 'memória (sem Redis configurado)' : 'arquivo local';

// pipeline([['INCR', 'k'], ['PFCOUNT', 'h']]) → [resultado, resultado]
export async function pipeline(commands) {
  if (!commands.length) return [];
  if (backend === 'redis') {
    const res = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands.map((c) => c.map(String))),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Redis HTTP ${res.status}`);
    const out = await res.json();
    return out.map((r) => {
      if (r.error) throw new Error(`Redis: ${r.error}`);
      return r.result;
    });
  }
  return commands.map((c) => local(c));
}

// ---------------------------------------------------------------- emulação local
const dataFile = join(fileURLToPath(new URL('..', import.meta.url)), '.data', 'store.json');
let db = null;
let saveTimer = null;

function load() {
  if (db) return db;
  try { db = JSON.parse(readFileSync(dataFile, 'utf8')); } catch { db = {}; }
  return db;
}

function persist() {
  if (process.env.VERCEL || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { mkdirSync(join(dataFile, '..'), { recursive: true }); writeFileSync(dataFile, JSON.stringify(db)); } catch { /* só memória */ }
  }, 300);
}

function entry(key, type, now = Date.now()) {
  const d = load();
  const e = d[key];
  if (e && e.exp && e.exp < now) delete d[key];
  if (!d[key]) {
    if (!type) return null;
    d[key] = { t: type, v: type === 'hash' ? {} : type === 'set' ? [] : type === 'zset' ? {} : type === 'list' ? [] : null };
  }
  return d[key];
}

function local([cmd, key, ...args]) {
  const C = cmd.toUpperCase();
  const now = Date.now();
  let r = null;
  switch (C) {
    case 'GET': r = entry(key)?.v ?? null; break;
    case 'SET': {
      // NX: só grava se a chave não existir (trava de "uma consulta por vez")
      if (args.slice(1).some((a) => String(a).toUpperCase() === 'NX') && entry(key)) { r = null; break; }
      entry(key, 'str').v = String(args[0]);
      const ex = args.findIndex((a) => String(a).toUpperCase() === 'EX');
      load()[key].exp = ex >= 0 ? now + Number(args[ex + 1]) * 1000 : undefined;
      r = 'OK'; break;
    }
    case 'INCR': case 'INCRBY': {
      const e = entry(key, 'str');
      e.v = String(Number(e.v || 0) + (C === 'INCR' ? 1 : Number(args[0])));
      r = Number(e.v); break;
    }
    case 'EXPIRE': { const e = entry(key); if (e) e.exp = now + Number(args[0]) * 1000; r = e ? 1 : 0; break; }
    case 'DEL': r = load()[key] ? 1 : 0; delete load()[key]; break;
    case 'HINCRBY': case 'HINCRBYFLOAT': {
      const e = entry(key, 'hash');
      e.v[args[0]] = String(Number(e.v[args[0]] || 0) + Number(args[1]));
      r = e.v[args[0]]; break;
    }
    case 'HSET': { const e = entry(key, 'hash'); for (let i = 0; i < args.length; i += 2) e.v[args[i]] = String(args[i + 1]); r = args.length / 2; break; }
    case 'HGETALL': { const v = entry(key)?.v ?? {}; r = Object.entries(v).flat(); break; }
    case 'HGET': r = entry(key)?.v?.[args[0]] ?? null; break;
    case 'HDEL': { const v = entry(key)?.v ?? {}; r = 0; for (const a of args) if (a in v) { delete v[a]; r++; } break; }
    case 'PFADD': {
      const e = entry(key, 'set');
      let added = 0;
      for (const a of args) if (!e.v.includes(String(a))) { e.v.push(String(a)); added = 1; }
      r = added; break;
    }
    case 'PFCOUNT': r = new Set([key, ...args].flatMap((k) => entry(k)?.v ?? [])).size; break;
    case 'SADD': {
      const e = entry(key, 'set');
      r = 0;
      for (const a of args) if (!e.v.includes(String(a))) { e.v.push(String(a)); r++; }
      break;
    }
    case 'SCARD': r = entry(key)?.v?.length ?? 0; break;
    case 'ZADD': { const e = entry(key, 'zset'); e.v[args[1]] = Number(args[0]); r = 1; break; }
    case 'ZREMRANGEBYSCORE': {
      const e = entry(key);
      if (!e) { r = 0; break; }
      const lo = Number(args[0] === '-inf' ? -Infinity : args[0]), hi = Number(args[1] === '+inf' ? Infinity : args[1]);
      let n = 0;
      for (const [m, s] of Object.entries(e.v)) if (s >= lo && s <= hi) { delete e.v[m]; n++; }
      r = n; break;
    }
    case 'ZCARD': r = Object.keys(entry(key)?.v ?? {}).length; break;
    case 'LPUSH': { const e = entry(key, 'list'); e.v.unshift(...args.map(String).reverse()); r = e.v.length; break; }
    case 'LTRIM': { const e = entry(key); if (e) e.v = e.v.slice(Number(args[0]), Number(args[1]) + 1); r = 'OK'; break; }
    case 'LRANGE': { const v = entry(key)?.v ?? []; const end = Number(args[1]); r = v.slice(Number(args[0]), end < 0 ? v.length + end + 1 : end + 1); break; }
    default: throw new Error(`comando não emulado: ${C}`);
  }
  persist();
  return r;
}
