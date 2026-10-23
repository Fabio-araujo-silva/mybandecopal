// No servidor (funções e scripts), aplica as receitas do cartaz uma vez, ao importar.
// No navegador quem faz isso é o app.js, que baixa /receitas.json junto com a TACO.
import receitas from '../public/receitas.json' with { type: 'json' };
import { applyReceitas } from '../public/nutrition.js';

applyReceitas(receitas);
