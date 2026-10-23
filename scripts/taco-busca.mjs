// Busca alimentos na TACO (e nos EXTRAS da TBCA) pelo nome, para montar receitas.
// Uso: node scripts/taco-busca.mjs "feijao fradinho" "cebola crua"
import { readFile } from 'node:fs/promises';
import { EXTRAS, norm } from '../public/nutrition.js';

const taco = JSON.parse(await readFile(new URL('../public/taco.json', import.meta.url), 'utf8'));
const extras = Object.entries(EXTRAS).filter(([, x]) => x.k != null).map(([id, x]) => ({ id, ...x }));

for (const q of process.argv.slice(2)) {
  const terms = norm(q).split(' ').filter(Boolean);
  const hit = (f) => terms.every((t) => norm(f.n).includes(t));
  console.log(`== ${q}`);
  for (const f of [...taco.filter(hit), ...extras.filter(hit)].slice(0, 25)) {
    const src = typeof f.id === 'number' ? 'TACO' : `TBCA ${f.tbca ?? ''}`.trim();
    console.log(`  ${String(f.id).padEnd(20)} ${f.n} — ${f.k} kcal · P ${f.p} · C ${f.c} · G ${f.g} (${src})`);
  }
}
