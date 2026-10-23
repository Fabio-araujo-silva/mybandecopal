// Gera public/taco.json a partir dos CSVs da TACO 4ª ed. (NEPA/UNICAMP),
// normalizados por github.com/raulfdm/taco-api (references/csv).
// Saída: [{ id, n, k, p, c, g, f }] por 100 g — kcal, proteína, carboidrato, lipídeos, fibra.
import { readFile, writeFile } from 'node:fs/promises';

const dir = new URL('../data/taco/', import.meta.url);

function parseCsv(text) {
  return text.trim().split(/\r?\n/).slice(1).map((line) => {
    const out = [];
    let cur = '', quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  });
}

const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

const foods = parseCsv(await readFile(new URL('food.csv', dir), 'utf8'));
const nutrients = new Map(parseCsv(await readFile(new URL('nutrients.csv', dir), 'utf8')).map((r) => [r[0], r]));

// colunas de nutrients.csv: foodId,moisture,kcal,kJ,protein,lipids,cholesterol,carbohydrates,dietaryFiber,...
const out = [];
for (const [id, , name] of foods) {
  const r = nutrients.get(id);
  const k = num(r?.[2]);
  if (k == null) continue; // a TACO tem alguns itens sem análise (ex.: leite integral)
  out.push({
    id: Number(id),
    n: name.replace(/\s+/g, ' ').trim(),
    k,
    p: num(r[4]) ?? 0,
    c: num(r[7]) ?? 0,
    g: num(r[5]) ?? 0,
    f: num(r[8]) ?? 0,
  });
}

await writeFile(new URL('../public/taco.json', import.meta.url), JSON.stringify(out));
console.log(`taco.json: ${out.length} alimentos`);
