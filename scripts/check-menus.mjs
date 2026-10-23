// Baixa o cardápio de todos os restaurantes e confere o parser:
// lista itens não reconhecidos e compara a refeição média com as kcal da SAS (quando há).
// Uso: node scripts/check-menus.mjs [--verbose]
import { readFile } from 'node:fs/promises';
import { getMenuCached, getRestaurantsCached } from '../lib/uspcache.js';
import { DISHES, choiceGroups, createDb, parseMenu } from '../public/nutrition.js';
import '../lib/receitas.js';

const verbose = process.argv.includes('--verbose');
const taco = JSON.parse(await readFile(new URL('../public/taco.json', import.meta.url), 'utf8'));
const db = createDb(taco);

function defaultMeal(items) {
  const groups = choiceGroups(items);
  const skip = new Set(Object.values(groups).flatMap((ids) => ids.slice(1)));
  let kcal = 0, p = 0, c = 0, gord = 0;
  for (const it of items) {
    if (skip.has(it.id)) continue;
    const dish = DISHES[it.key];
    const n = db.nutrients({ base: it.key, grams: dish.qty * dish.units[0][1], oleo: dish.oleo }, 0.1);
    kcal += n.kcal; p += n.p; c += n.c; gord += n.g;
  }
  return { kcal: Math.round(kcal), p: Math.round(p), c: Math.round(c), g: Math.round(gord) };
}

for (const d of Object.keys(DISHES)) db.per100(d); // valida que todo ingrediente existe

const unknown = new Map();
const rows = [];
// pelo cache (como o site): rodar de novo dentro de 1 h não consulta a USP outra vez
for (const campus of (await getRestaurantsCached()).restaurants) {
  for (const r of campus.restaurants) {
    let menu;
    try { ({ menu } = await getMenuCached(r.id)); } catch (e) { console.log(`! ${r.name}: ${e.message}`); continue; }
    for (const day of menu.days) {
      for (const [mealName, meal] of [['almoço', day.lunch], ['jantar', day.dinner]]) {
        const parsed = parseMenu(meal.menu);
        if (parsed.closed) continue;
        for (const it of parsed.items) {
          if (it.generic) unknown.set(it.text, (unknown.get(it.text) || 0) + 1);
          if (verbose) console.log(`  ${r.name} ${day.date} ${mealName} | ${it.text} → ${it.key} (${it.role})`);
        }
        rows.push({ r: r.name, date: day.date, meal: mealName, sas: meal.kcal ?? parsed.kcal, est: defaultMeal(parsed.items) });
      }
    }
  }
}

console.log(`\nrefeições analisadas: ${rows.length}`);
const withSas = rows.filter((x) => x.sas);
if (withSas.length) {
  const diffs = withSas.map((x) => (x.est.kcal - x.sas) / x.sas);
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  console.log(`com kcal da SAS: ${withSas.length} — diferença média da estimativa: ${(mean * 100).toFixed(1)}%`);
  for (const x of withSas.slice(0, 12)) console.log(`  ${x.r} ${x.date} ${x.meal}: SAS ${x.sas} · nossa ${x.est.kcal} (P${x.est.p} C${x.est.c} G${x.est.g})`);
}
const sc = rows.filter((x) => /\(SC\)/.test(x.r)).slice(0, 6);
for (const x of sc) console.log(`  ${x.r} ${x.date} ${x.meal}: nossa ${x.est.kcal} kcal (P${x.est.p} C${x.est.c} G${x.est.g})`);
console.log(`\nitens não reconhecidos (${unknown.size}):`);
for (const [t, n] of [...unknown].sort((a, b) => b[1] - a[1])) console.log(`  ${n}× ${t}`);
