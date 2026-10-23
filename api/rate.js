import { recordRating } from '../lib/stats.js';
import { readJson } from '../lib/auth.js';

// Avaliação em estrelas (1–5) da proteína/guarnição/sobremesa do dia. Sem login.
// O navegador manda a nota anterior (prev) para a média não contar duas vezes quando muda a nota.
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }
  try {
    const { key, label, cat, stars, prev } = await readJson(req);
    const out = await recordRating({ key, label, cat, stars, prev });
    res.status(out.ok ? 200 : 400).json(out);
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err.message || err) });
  }
}
