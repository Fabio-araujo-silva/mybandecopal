import { addReport } from '../lib/reports.js';
import { readJson } from '../lib/auth.js';

// "Este prato mudou lá no bandejão" — report anônimo de um usuário (sem login; um por navegador).
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }
  try {
    const out = await addReport(await readJson(req));
    res.status(200).json({ ok: true, ...out });
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err.message || err) });
  }
}
