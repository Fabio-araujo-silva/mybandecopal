// Cardápios e lista de restaurantes guardados no nosso Redis, para poupar a API da USP: cada
// restaurante é consultado lá no máximo uma vez por hora (a lista, uma vez por dia). A cada
// consulta o resultado é comparado com o guardado e só é regravado se mudou. Se a USP falhar,
// segue valendo a última versão guardada.
//   mbp:usp:<nome>          → {"value":…, "hash":"…", "changedAt":<ms>}  (só muda quando o dado muda)
//   mbp:usp:<nome>:checked  → <ms> da última consulta à USP
//   mbp:usp:<nome>:lock     → só uma requisição por vez vai à USP
import { createHash } from 'node:crypto';
import { pipeline } from './store.js';
import { getMenu, getRestaurants } from './usp.js';
import { recordMudancas } from './registro.js';

const P = 'mbp:usp:';
export const MENU_MAX_AGE_MS = 60 * 60 * 1000;
const RESTAURANTS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const LOCK_S = 30;          // tempo para a consulta em andamento terminar
const RETRY_AFTER_S = 300;  // USP falhou: espera 5 min antes de tentar de novo

const hashOf = (value) => createHash('sha1').update(JSON.stringify(value)).digest('hex');

// → { value, fetched (foi à USP), changed (o dado mudou), ms, error }
async function cached(name, maxAgeMs, fetcher) {
  const key = `${P}${name}`;
  const [raw, checked] = await pipeline([['GET', key], ['GET', `${key}:checked`]]);
  let saved = null;
  try { saved = raw ? JSON.parse(raw) : null; } catch { /* estragado: busca de novo */ }
  if (saved && Date.now() - Number(checked || 0) < maxAgeMs) return { value: saved.value, fetched: false, changed: false };

  // vencido: só uma requisição vai à USP; as outras (e as que chegam enquanto a USP está fora)
  // servem o guardado. Sem nada guardado, todas tentam.
  if (saved) {
    const [got] = await pipeline([['SET', `${key}:lock`, '1', 'NX', 'EX', LOCK_S]]);
    if (got !== 'OK') return { value: saved.value, fetched: false, changed: false };
  }

  const t0 = Date.now();
  try {
    const value = await fetcher();
    const hash = hashOf(value);
    const changed = hash !== saved?.hash;
    const now = Date.now();
    const cmds = [['SET', `${key}:checked`, now], ['DEL', `${key}:lock`]];
    if (changed) cmds.unshift(['SET', key, JSON.stringify({ value, hash, changedAt: now })]);
    await pipeline(cmds);
    return { value: changed ? value : saved.value, fetched: true, changed, ms: Date.now() - t0, previous: changed ? saved?.value : undefined };
  } catch (err) {
    if (!saved) throw err;
    await pipeline([['SET', `${key}:lock`, '1', 'EX', RETRY_AFTER_S]]).catch(() => {});
    return { value: saved.value, fetched: true, changed: false, ms: Date.now() - t0, error: String(err.message || err) };
  }
}

export async function getMenuCached(id) {
  if (!/^\d{1,3}$/.test(String(id))) throw new Error('id de restaurante inválido');
  const r = await cached(`menu:${id}`, MENU_MAX_AGE_MS, () => getMenu(id));
  // a USP mudou o cardápio: grava o que mudou em cada refeição (vira "!" no app e aparece no /admin)
  if (r.changed && r.previous) await recordMudancas(id, r.previous, r.value).catch(() => {});
  return { ...r, menu: r.value };
}

export async function getRestaurantsCached() {
  const r = await cached('restaurants', RESTAURANTS_MAX_AGE_MS, getRestaurants);
  return { ...r, restaurants: r.value };
}
