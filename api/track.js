import { recordEvent } from '../lib/stats.js';
import { readJson } from '../lib/auth.js';

// Recebe eventos de uso anônimos do navegador (view/meal/choice/portion/swap).
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }
  try {
    const ev = await readJson(req);
    await recordEvent(ev);
  } catch { /* telemetria nunca derruba nada */ }
  res.status(204).end();
}
