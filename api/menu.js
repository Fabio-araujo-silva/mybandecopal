import { getMenu } from '../lib/usp.js';
import { recordUspFetch } from '../lib/stats.js';
import { archiveMenu } from '../lib/archive.js';
import { parseMenu } from '../public/nutrition.js';

// Detecta pratos que o parser não reconheceu, para aparecerem na página /admin e virarem regra.
function genericItems(menu) {
  const out = [];
  for (const day of menu.days) {
    for (const meal of [day.lunch, day.dinner]) {
      const parsed = parseMenu(meal.menu);
      if (parsed.closed) continue;
      for (const it of parsed.items) if (it.generic) out.push({ text: it.text, role: it.role });
    }
  }
  return out;
}

export default async function handler(req, res) {
  const id = new URL(req.url, 'http://x').searchParams.get('id') || '2';
  const t0 = Date.now();
  try {
    const menu = await getMenu(id);
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
    res.status(200).json(menu);
    // registra a chamada à USP e arquiva os cardápios (só roda quando o cache da Vercel expira)
    recordUspFetch({ restaurant: id, ok: true, ms: Date.now() - t0, generic: genericItems(menu) }).catch(() => {});
    archiveMenu(id, menu.days).catch(() => {});
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
    recordUspFetch({ restaurant: id, ok: false, ms: Date.now() - t0, error: String(err.message || err) }).catch(() => {});
  }
}
