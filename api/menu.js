import { getMenuCached } from '../lib/uspcache.js';
import { recordUspFetch } from '../lib/stats.js';
import { archiveMenu } from '../lib/archive.js';
import { parseMenu } from '../public/nutrition.js';
import '../lib/receitas.js';

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
    // vem do nosso Redis; a USP só é consultada quando o guardado tem mais de 1 h
    const { menu, fetched, changed, ms, error } = await getMenuCached(id);
    // registra a consulta à USP e, se o cardápio mudou, arquiva e procura pratos não reconhecidos
    if (fetched) await recordUspFetch({ restaurant: id, ok: !error, ms, error, generic: changed ? genericItems(menu) : [] }).catch(() => {});
    if (changed) await archiveMenu(id, menu.days).catch(() => {});
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
    res.status(200).json(menu);
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
    recordUspFetch({ restaurant: id, ok: false, ms: Date.now() - t0, error: String(err.message || err) }).catch(() => {});
  }
}
