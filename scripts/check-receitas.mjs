// Confere public/receitas.json e mostra o que cada receita vira (kcal e macros por 100 g, pela
// TACO/TBCA). Opcional: textos do cardápio para ver em qual prato cada um cai.
// Uso: node scripts/check-receitas.mjs ["Hamburguer bovino ao molho barbecue" ...]
import { readFile } from 'node:fs/promises';
import { DISHES, EXTRAS, applyReceitas, createDb, matchDish } from '../public/nutrition.js';

const read = async (p) => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8'));
const [taco, receitas] = await Promise.all([read('../public/taco.json'), read('../public/receitas.json')]);
const tacoIds = new Set(taco.map((f) => f.id));
const KINDS = ['base', 'proteina', 'vegetariano', 'guarnicao', 'salada', 'fruta', 'doce', 'pao', 'bebida'];
const FIXOS = ['refresco', 'refresco_zero', 'picole']; // valores medidos no bandejão, não mexer

const problems = [];
const seen = new Set();
for (const r of receitas.receitas ?? []) {
  const where = `receita "${r.chave}"`;
  if (!r.chave) { problems.push('receita sem chave'); continue; }
  if (seen.has(r.chave)) problems.push(`${where}: chave repetida`);
  seen.add(r.chave);
  if (FIXOS.includes(r.chave)) problems.push(`${where}: suco/picolé têm valor fixo, não entram em receitas.json`);
  const existing = DISHES[r.chave];
  if (!existing && !r.base) problems.push(`${where}: chave nova precisa de "base" (prato do qual herda medidas)`);
  if (r.base && !DISHES[r.base]) problems.push(`${where}: base "${r.base}" não existe em DISHES`);
  if (r.tipo && !KINDS.includes(r.tipo)) problems.push(`${where}: tipo "${r.tipo}" inválido`);
  if (!existing && !r.tipo) problems.push(`${where}: chave nova precisa de "tipo"`);
  if (!existing && !r.composicao) problems.push(`${where}: chave nova precisa de "composicao"`);
  if ((r.tipo ?? existing?.kind) === 'salada' && (r.tipo !== 'salada' || !r.nome)) problems.push(`${where}: salada precisa de tipo "salada" e nome (é o que aparece no /admin)`);
  if (!r.ingredientes) problems.push(`${where}: falta "ingredientes" (o texto do cartaz)`);
  for (const t of r.texto ?? []) { try { new RegExp(t); } catch { problems.push(`${where}: regex inválida ${t}`); } }
  if (r.composicao) {
    let sum = 0;
    for (const [ing, w] of r.composicao) {
      sum += w;
      if (typeof ing === 'number' ? !tacoIds.has(ing) : !EXTRAS[ing]) problems.push(`${where}: ingrediente ${ing} não existe (TACO id ou EXTRAS "x:...")`);
      if (!(w > 0)) problems.push(`${where}: partes de ${ing} devem ser > 0`);
    }
    if (Math.abs(sum - 100) > 0.5) problems.push(`${where}: composição soma ${sum}, deveria somar 100`);
  }
}

if (problems.length) {
  console.log('PROBLEMAS:');
  for (const p of problems) console.log(`  - ${p}`);
  process.exitCode = 1;
}

applyReceitas(receitas);
const db = createDb(taco);
console.log(`\n${receitas.receitas.length} receitas — por 100 g (TACO/TBCA):`);
for (const r of receitas.receitas) {
  if (!DISHES[r.chave]) continue;
  const n = db.per100(r.chave);
  const d = DISHES[r.chave];
  const porcao = d.qty * d.units[0][1];
  console.log(`  ${r.chave.padEnd(26)} ${String(Math.round(n.k)).padStart(4)} kcal · P ${n.p.toFixed(1)} · C ${n.c.toFixed(1)} · G ${n.g.toFixed(1)}  | porção padrão ${porcao} g = ${Math.round((n.k * porcao) / 100)} kcal${d.oleo ? ' (+10% preparo)' : ''}`);
}

const textos = process.argv.slice(2);
if (textos.length) {
  console.log('\nTexto do cardápio → prato:');
  for (const t of textos) console.log(`  "${t}" → ${matchDish(t) ?? '(nenhum: genérico)'}`);
}
