// Arquivo histórico dos cardápios, para análise de dados depois.
// Cada restaurante vira um hash mbp:menuhist:<id> com um campo por data (dd/mm/aaaa).
// Regravar a mesma data só atualiza (deduplica); o histórico cresce conforme as datas passam.
import { pipeline } from './store.js';

const P = 'mbp:menuhist:';

export async function archiveMenu(restId, days, name) {
  const id = String(restId);
  const cmds = [['HSET', `${P}ids`, id, '1']]; // índice dos restaurantes arquivados
  let n = 0;
  for (const d of days || []) {
    if (!d?.date) continue;
    cmds.push(['HSET', `${P}${id}`, d.date, JSON.stringify({ lunch: d.lunch, dinner: d.dinner })]);
    n++;
  }
  if (name) cmds.push(['HSET', `${P}names`, id, name]);
  await pipeline(cmds);
  return n;
}

export async function listArchive(ids) {
  const [idsFlat, namesFlat] = await pipeline([['HGETALL', `${P}ids`], ['HGETALL', `${P}names`]]);
  const names = {};
  for (let i = 0; i < (namesFlat?.length || 0); i += 2) names[namesFlat[i]] = namesFlat[i + 1];
  const indexed = [];
  for (let i = 0; i < (idsFlat?.length || 0); i += 2) indexed.push(idsFlat[i]);
  const idList = (ids && ids.length ? ids : indexed).map(String);
  const hists = await pipeline(idList.map((id) => ['HGETALL', `${P}${id}`]));
  const out = [];
  idList.forEach((id, i) => {
    const flat = hists[i] || [];
    for (let j = 0; j < flat.length; j += 2) {
      let day; try { day = JSON.parse(flat[j + 1]); } catch { day = null; }
      if (day) out.push({ restaurante: id, nome: names[id] || '', data: flat[j], almoco: day.lunch, jantar: day.dinner });
    }
  });
  // ordena por restaurante e data (dd/mm/aaaa)
  const toSort = (s) => s.split('/').reverse().join('');
  return out.sort((a, b) => (a.restaurante - b.restaurante) || toSort(a.data).localeCompare(toSort(b.data)));
}
