// Login do admin: uma senha só (variável ADMIN_PASSWORD na Vercel), sessão em cookie
// HttpOnly assinado com HMAC. Trocar a senha invalida todas as sessões.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { pipeline } from './store.js';

const COOKIE = 'mbp_admin';
const SESSION_DAYS = 7;
const MAX_FAILS = 8;          // tentativas erradas por IP…
const FAIL_WINDOW_S = 15 * 60; // …a cada 15 minutos

const password = () => process.env.ADMIN_PASSWORD || '';
export const adminConfigured = () => password().length >= 8;

const key = () => createHash('sha256').update(`mybandecopal-session:${process.env.ADMIN_SESSION_SECRET || ''}:${password()}`).digest();
const b64 = (buf) => Buffer.from(buf).toString('base64url');
const sign = (payload) => b64(createHmac('sha256', key()).update(payload).digest());

export function checkPassword(attempt) {
  const a = createHash('sha256').update(String(attempt ?? '')).digest();
  const b = createHash('sha256').update(password()).digest();
  return adminConfigured() && timingSafeEqual(a, b);
}

export function sessionCookie() {
  const payload = b64(JSON.stringify({ exp: Date.now() + SESSION_DAYS * 86400000 }));
  const secure = process.env.VERCEL ? '; Secure' : '';
  return `${COOKIE}=${payload}.${sign(payload)}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}

export const clearCookie = () => `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=0${process.env.VERCEL ? '; Secure' : ''}`;

export function isAdmin(req) {
  if (!adminConfigured()) return false;
  const raw = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!raw) return false;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig) return false;
  const expected = Buffer.from(sign(payload));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now(); } catch { return false; }
}

// limite de tentativas: o IP entra só como hash, junto com a janela de tempo
function failKey(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  const bucket = Math.floor(Date.now() / (FAIL_WINDOW_S * 1000));
  return `mbp:loginfail:${createHash('sha256').update(`${ip}|${bucket}`).digest('hex').slice(0, 24)}`;
}

export async function tooManyFails(req) {
  const [n] = await pipeline([['GET', failKey(req)]]);
  return Number(n || 0) >= MAX_FAILS;
}

export async function registerFail(req) {
  const k = failKey(req);
  await pipeline([['INCR', k], ['EXPIRE', k, FAIL_WINDOW_S]]);
}

export async function readJson(req) {
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {};
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 4096) throw new Error('corpo grande demais');
  }
  return raw ? JSON.parse(raw) : {};
}
