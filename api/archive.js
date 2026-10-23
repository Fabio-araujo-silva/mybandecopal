// Coleta diária: busca o cardápio de TODOS os restaurantes e arquiva (mesmo os que ninguém abriu).
// Roda pelo Vercel Cron (ver vercel.json). Protegido por CRON_SECRET.
import { getMenu, getRestaurants } from '../lib/usp.js';
import { archiveMenu } from '../lib/archive.js';

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // sem segredo configurado, não bloqueia (uso local)
  const auth = req.headers.authorization || '';
  const key = new URL(req.url, 'http://x').searchParams.get('key');
  return auth === `Bearer ${secret}` || key === secret;
}

export default async function handler(req, res) {
  if (!authorized(req)) { res.status(401).json({ error: 'não autorizado' }); return; }
  try {
    const campi = await getRestaurants();
    const restaurants = campi.flatMap((c) => c.restaurants.map((r) => ({ id: r.id, name: r.name })));
    let dias = 0, ok = 0, erros = 0;
    for (const r of restaurants) {
      try {
        const menu = await getMenu(r.id);
        dias += await archiveMenu(r.id, menu.days, r.name);
        ok++;
      } catch { erros++; }
    }
    res.status(200).json({ restaurantes: restaurants.length, ok, erros, diasArquivados: dias });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
