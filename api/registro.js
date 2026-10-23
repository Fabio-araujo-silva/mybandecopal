import { readRegistros } from '../lib/registro.js';

// /api/registro?id=2 → { registros: { "23/10/2026|dinner": { suco, saladas } } }
// Cache curto: o que é registrado no /admin aparece para todo mundo em menos de 1 min.
export default async function handler(req, res) {
  const id = new URL(req.url, 'http://x').searchParams.get('id') || '2';
  try {
    const registros = await readRegistros(id);
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    res.status(200).json({ registros });
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
}
