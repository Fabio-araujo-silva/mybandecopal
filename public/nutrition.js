// Núcleo de nutrição: interpreta o texto do cardápio USP, associa cada item a uma
// receita feita de alimentos da TACO e calcula kcal/macros pela porção escolhida.
// Funciona no navegador e no Node (scripts/check-menus.mjs).

// ---------------------------------------------------------------------------
// Ingredientes fora da TACO, por 100 g. `tbca` = código na TBCA 7.3 (FCF-USP/FoRC,
// www.tbca.net.br), de onde vêm os valores; `from` = [idTACO, fator por grama].
// Suco e picolé ficam com os valores medidos no bandejão.
export const EXTRAS = {
  'x:macarrao': { n: 'Macarrão cozido', tbca: 'BRC0116A', k: 101, p: 3.73, c: 21, g: 0.48, f: 1.2 },
  'x:graodebico': { n: 'Grão-de-bico cozido, drenado', tbca: 'BRC0031T', k: 115, p: 6.2, c: 21.5, g: 1.7, f: 5.5 },
  'x:leite': { n: 'Leite integral UHT', tbca: 'BRC0044G', k: 65, p: 2.35, c: 7.16, g: 3.04, f: 0 },
  'x:gelatina': { n: 'Gelatina pronta', tbca: 'BRC0060K', k: 57, p: 1.24, c: 12.8, g: 0.08, f: 0 },
  // suco com açúcar do bandejão: 53 kcal por copo de 200 ml
  'x:refresco': { n: 'Refresco adoçado (53 kcal/200 ml: TACO açúcar a 6,85%)', from: [[494, 0.0685]] },
  'x:refresco-zero': { n: 'Refresco sem açúcar (~39 kcal/200 ml: TACO açúcar a 5%)', from: [[494, 0.05]] },
  'x:pvt': { n: 'PVT hidratada', tbca: 'BRC0170T', k: 188, p: 25.4, c: 23.1, g: 0.36, f: 4.8 },
  'x:soja': { n: 'Soja em grão cozida', tbca: 'BRC0147T', k: 168, p: 16.2, c: 9.48, g: 9.26, f: 8.92 },
  'x:bulgur': { n: 'Trigo para quibe cozido', tbca: 'BRC0405A', k: 80, p: 3.08, c: 18.6, g: 0.24, f: 4.5 },
  'x:barra': { n: 'Barra de cereais', tbca: 'BRC0082A', k: 396, p: 6.25, c: 76.1, g: 8.53, f: 5.25 },
  'x:torrone': { n: 'Torrone', tbca: 'BRC0130K', k: 391, p: 3.33, c: 92.4, g: 1.67, f: 3.3 },
  'x:escarola-refogada': { n: 'Escarola refogada', tbca: 'BRC0950B', k: 33, p: 1.92, c: 3.9, g: 1.55, f: 2.27 },
  'x:sagu': { n: 'Sagu com suco de uva', tbca: 'BRC0083K', k: 88, p: 0.03, c: 22.2, g: 0, f: 0.18 },
  'x:catchup': { n: 'Catchup', tbca: 'BRC0030L', k: 123, p: 1.12, c: 29.6, g: 0.11, f: 0.32 },
  'x:mostarda': { n: 'Mostarda (molho)', tbca: 'BRC0029L', k: 60, p: 3.74, c: 5.83, g: 3.34, f: 4 },
  'x:chocolate-po': { n: 'Chocolate em pó', tbca: 'BRC0094K', k: 387, p: 8.9, c: 81.4, g: 5, f: 9.53 },
  // picolé do bandejão: 58 kcal por unidade (60 g) → 96,7 kcal/100 g; macros da estimativa antiga reescalonados
  'x:sorvete': { n: 'Picolé de creme (58 kcal por unidade)', k: 96.7, p: 1.5, c: 14.5, g: 3.3, f: 0 },
  'x:agua': { n: 'Água / vinagre', k: 0, p: 0, c: 0, g: 0, f: 0 },
  // concha extra de molho (a tia capricha)
  'x:molho-tomate': { n: 'Molho de tomate caseiro', tbca: 'BRC1192B', k: 46, p: 1.92, c: 7.84, g: 1.31, f: 2.91 },
  'x:molho-creme': { n: 'Molho branco', tbca: 'BRC0004G', k: 153, p: 4.34, c: 10.9, g: 10.3, f: 0.19 },
};

// quando o prato tem molho, dá pra pedir uma concha a mais. Detecta o tipo pelo nome.
export function sauceType(text) {
  const t = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/estrogonofe|stroganoff|strogonoff|fricasse|parmegiana|molho branco|ao molho de queijo|quatro queijos|cremoso/.test(t)) return 'creme';
  if (/\bmolho\b|ao sugo|provencal|barbecue|ferrugem|shoyu|agridoce|cacarola|ensopad|ao vinho|pomodoro|bolonhesa|\broti\b|madeira/.test(t)) return 'tomate';
  return null;
}

// ---------------------------------------------------------------------------
// Medidas caseiras. Cada lista termina em gramas, para ajuste fino.
const g = ['g', 1];
const M = {
  arroz: [['concha', 150], ['colher de servir', 50], ['colher de sopa', 25], g],
  feijao: [['concha', 140], ['colher de sopa', 20], g],
  servir: [['colher de servir', 60], ['colher de sopa', 25], g],
  legume: [['colher de servir', 50], ['colher de sopa', 20], g],
  salada: [['porção', 40], ['pegador', 15], g],
  sopa: [['concha', 150], g],
  un: (nome, gramas) => [[nome, gramas], g],
  colherSopa: (gramas) => [['colher de sopa', gramas], g],
};

// Atalho para declarar pratos: d(tipo, rótulo, composição por 100 g, medidas, qtd. padrão, opções)
// `oleo: true` = preparação que recebe o ajuste de gordura do bandejão.
// Sobremesa (fruta ou doce) é sempre uma só unidade/fatia no bandejão: 0 ou 1, sem gramas.
function d(kind, label, comp, units, qty, oleo = true) {
  if (kind === 'fruta' || kind === 'doce') return { kind, label, comp, units: [units[0]], qty: 1, max: 1, oleo };
  return { kind, label, comp, units, qty, oleo };
}

export const DISHES = {
  // base
  arroz: d('base', 'Arroz branco cozido', [[3, 100]], M.arroz, 1),
  arroz_integral: d('base', 'Arroz integral cozido', [[1, 100]], M.arroz, 1),
  arroz_grega: d('guarnicao', 'Arroz à grega', [[3, 85], [560, 5], [109, 5], [45, 5]], M.arroz, 2),
  feijao: d('base', 'Feijão carioca cozido', [[561, 100]], M.feijao, 1),
  feijao_preto: d('base', 'Feijão preto cozido', [[567, 100]], M.feijao, 1),
  feijoada: d('proteina', 'Feijoada', [[540, 100]], M.sopa, 1),
  tropeiro: d('guarnicao', 'Feijão tropeiro', [[539, 100]], M.servir, 2),
  baiao: d('guarnicao', 'Baião de dois', [[527, 100]], M.servir, 2),
  virado: d('guarnicao', 'Virado à paulista', [[555, 100]], M.servir, 2),
  carreteiro: d('proteina', 'Arroz carreteiro', [[526, 100]], M.servir, 3),

  // carnes
  frango_assado: d('proteina', 'Frango (coxa/sobrecoxa) assado com pele', [[396, 50], [411, 50]], M.un('pedaço', 100), 1),
  frango_empanado: d('proteina', 'Filé de frango à milanesa', [[401, 100]], M.un('filé', 110), 1),
  frango_passarinho: d('proteina', 'Frango à passarinho (coxa + fritura)', [[396, 94], [272, 6]], M.un('pedaço', 35), 3, false),
  frango_grelhado: d('proteina', 'Peito de frango grelhado', [[410, 100]], M.un('filé', 110), 1),
  frango_molho: d('proteina', 'Peito de frango cozido com molho', [[408, 80], [159, 12], [107, 8]], M.servir, 2),
  frango_shoyu: d('proteina', 'Frango em tiras com shoyu', [[408, 82], [518, 6], [107, 6], [144, 6]], M.servir, 2),
  frango_fricasse: d('proteina', 'Fricassê de frango', [[408, 45], [447, 15], [45, 15], ['x:leite', 15], [90, 10]], M.servir, 2),
  frango_estrogonofe: d('proteina', 'Estrogonofe de frango', [[538, 100]], M.servir, 2),
  frango: d('proteina', 'Frango sem pele cozido', [[404, 100]], M.un('pedaço', 100), 1),
  bife_cacarola: d('proteina', 'Bife de caçarola (coxão mole cozido)', [[351, 85], [159, 15]], M.un('bife', 100), 1),
  bife_acebolado: d('proteina', 'Bife acebolado (alcatra grelhada)', [[370, 85], [107, 15]], M.un('bife', 100), 1),
  bife_molho: d('proteina', 'Bife ao molho (alcatra grelhada)', [[370, 85], [159, 15]], M.un('bife', 100), 1),
  bife: d('proteina', 'Bife bovino (alcatra grelhada)', [[370, 100]], M.un('bife', 100), 1),
  carne_moida: d('proteina', 'Carne moída refogada (acém)', [[326, 85], [159, 10], [107, 5]], [['concha', 120], ['colher de servir', 60], g], 1),
  carne_cubos: d('proteina', 'Carne em cubos ao molho (músculo)', [[371, 80], [159, 10], [107, 5], [109, 5]], M.servir, 2),
  carne_estrogonofe: d('proteina', 'Estrogonofe de carne', [[537, 100]], M.servir, 2),
  carne_seca: d('proteina', 'Carne-seca cozida', [[384, 100]], M.servir, 2),
  carne_assada: d('proteina', 'Carne assada fatiada (lagarto) ao molho', [[363, 85], [159, 15]], M.un('fatia', 50), 2),
  cupim: d('proteina', 'Cupim assado', [[353, 90], [159, 10]], M.un('fatia', 50), 2),
  carne_tiras: d('proteina', 'Carne em tiras (contrafilé) com molho', [[346, 75], [159, 10], [107, 8], [144, 7]], M.servir, 2),
  carne_desfiada: d('proteina', 'Carne desfiada ao molho (carne louca)', [[363, 80], [159, 12], [107, 8]], M.servir, 2),
  suino: d('proteina', 'Carne suína (lombo) acebolada', [[432, 85], [107, 15]], M.servir, 2),
  almondega: d('proteina', 'Almôndegas fritas ao molho', [[331, 75], [159, 25]], M.un('almôndega', 30), 4, false),
  hamburguer: d('proteina', 'Hambúrguer bovino grelhado', [[417, 88], [159, 8], [494, 4]], M.un('hambúrguer', 45), 3),
  lombo: d('proteina', 'Lombo suíno assado', [[432, 90], [107, 10]], M.un('fatia', 50), 2),
  pernil: d('proteina', 'Pernil suíno assado', [[435, 100]], M.un('fatia', 50), 2),
  bisteca: d('proteina', 'Bisteca suína grelhada', [[429, 100]], M.un('bisteca', 100), 1),
  linguica: d('proteina', 'Linguiça suína frita acebolada', [[422, 85], [107, 15]], M.un('gomo', 60), 2.5, false),
  costela: d('proteina', 'Costela bovina assada', [[347, 100]], M.un('pedaço', 120), 1),
  peixe_frito: d('proteina', 'Filé de peixe frito (merluza/pescada)', [[303, 50], [306, 50]], M.un('filé', 100), 1, false),
  peixe: d('proteina', 'Filé de peixe assado (merluza)', [[301, 85], [159, 10], [107, 5]], M.un('filé', 100), 1),
  quibe_frito: d('proteina', 'Quibe frito', [[442, 100]], M.un('fatia', 100), 1, false),
  quibe: d('proteina', 'Quibe assado', [[440, 100]], M.un('fatia', 100), 1),
  escondidinho_carne: d('proteina', 'Escondidinho de carne', [[326, 35], [129, 45], ['x:leite', 8], [261, 2], [463, 10]], M.un('pedaço', 150), 1),
  lasanha_carne: d('proteina', 'Lasanha à bolonhesa', [[37, 40], [326, 25], [159, 15], [463, 12], ['x:leite', 8]], M.un('pedaço', 150), 1),
  ovo_frito: d('proteina', 'Ovo frito', [[490, 100]], M.un('ovo', 50), 2, false),
  ovo_cozido: d('proteina', 'Ovo cozido', [[488, 100]], M.un('ovo', 50), 2),
  ovo_mexido: d('proteina', 'Ovos mexidos', [[490, 100]], M.servir, 2, false),
  omelete: d('proteina', 'Omelete com queijo e tomate', [[484, 75], [157, 20], [133, 5]], M.un('omelete', 100), 1, false),
  carne_generica: d('proteina', 'Carne bovina cozida (genérico)', [[371, 90], [159, 10]], M.servir, 2),

  // opções vegetarianas
  pvt: d('vegetariano', 'PVT refogada ao molho', [['x:pvt', 70], [159, 20], [107, 10]], M.servir, 2),
  pvt_legumes: d('vegetariano', 'PVT com legumes', [['x:pvt', 50], [109, 15], [70, 15], [159, 15], [107, 5]], M.servir, 2),
  pvt_azeitona: d('vegetariano', 'PVT com azeitonas', [['x:pvt', 70], [521, 8], [159, 15], [107, 7]], M.servir, 2),
  quibe_pvt: d('vegetariano', 'Quibe de PVT assado', [['x:pvt', 45], ['x:bulgur', 45], [107, 5], [272, 5]], M.un('fatia', 100), 1, false),
  hamburguer_pvt: d('vegetariano', 'Hambúrguer de PVT', [['x:pvt', 70], [35, 8], [107, 10], [159, 8], [494, 4]], M.un('hambúrguer', 45), 3),
  escondidinho_pvt: d('vegetariano', 'Escondidinho de PVT', [['x:pvt', 35], [129, 45], ['x:leite', 8], [261, 2], [463, 10]], M.un('pedaço', 150), 1),
  torta_pvt: d('vegetariano', 'Torta salgada de PVT', [['x:pvt', 35], [35, 20], [489, 10], ['x:leite', 15], [272, 5], [157, 10], [107, 5]], M.un('pedaço', 120), 1, false),
  estrogonofe_pvt: d('vegetariano', 'Estrogonofe de PVT', [['x:pvt', 60], [447, 15], [159, 15], [107, 10]], M.servir, 2),
  lentilha_berinjela: d('vegetariano', 'Lentilha com berinjela', [[577, 65], [95, 25], [107, 10]], M.servir, 2),
  lentilha: d('vegetariano', 'Lentilha cozida', [[577, 90], [107, 5], [109, 5]], M.servir, 2),
  hamburguer_lentilha: d('vegetariano', 'Hambúrguer de lentilha', [[577, 70], [35, 10], [109, 10], [107, 10]], M.un('hambúrguer', 45), 3),
  graodebico: d('vegetariano', 'Bifinho de grão-de-bico ao sugo', [['x:graodebico', 75], [35, 8], [159, 12], [107, 5]], M.un('bifinho', 50), 2),
  soja: d('vegetariano', 'Soja em grão ao vinagrete', [['x:soja', 70], [157, 15], [107, 10], [144, 5]], M.servir, 2),
  tofu: d('vegetariano', 'Tofu', [[584, 100]], M.servir, 2),
  parmegiana_berinjela: d('vegetariano', 'Berinjela à parmegiana', [[95, 55], [463, 15], [159, 20], [34, 5], [489, 5]], M.un('pedaço', 150), 1),
  lasanha_legumes: d('vegetariano', 'Lasanha de legumes', [[37, 35], [100, 25], [463, 15], ['x:leite', 15], [35, 3], [261, 2], [159, 5]], M.un('pedaço', 150), 1),
  tomate_recheado: d('vegetariano', 'Tomate recheado', [[157, 60], [3, 20], [463, 10], [34, 5], [107, 5]], M.un('tomate', 150), 1),
  paella: d('vegetariano', 'Paella vegetariana', [[3, 65], [143, 8], [560, 10], [109, 8], [157, 9]], M.servir, 2),
  creme_ervilha: d('vegetariano', 'Creme de ervilha', [[560, 50], ['x:leite', 35], [42, 3], [107, 7], [261, 5]], M.sopa, 1),
  estrogonofe_legumes: d('vegetariano', 'Estrogonofe de legumes', [[109, 20], [70, 15], [118, 15], [100, 15], [447, 15], [159, 15], [107, 5]], M.servir, 2),
  batatalhoada: d('vegetariano', 'Batatalhoada (batata com alho e azeite)', [[94, 95], [260, 3], [82, 2]], M.servir, 2),
  croquete_pvt: d('vegetariano', 'Croquete de PVT', [['x:pvt', 50], [35, 15], [34, 10], [272, 15], [107, 10]], M.un('croquete', 40), 3, false),
  batata_recheada_pvt: d('vegetariano', 'Batata recheada com PVT', [[91, 60], ['x:pvt', 25], [463, 10], [159, 5]], M.un('batata', 200), 1),
  bolinho_ricota: d('vegetariano', 'Bolinho de ricota ao sugo', [[469, 60], [35, 15], [489, 10], [159, 15]], M.un('bolinho', 40), 3),
  bolinho_arroz: d('vegetariano', 'Bolinho de arroz', [[530, 100]], M.un('bolinho', 40), 3, false),
  cassoulet_veg: d('vegetariano', 'Cassoulet vegetariano (feijão branco e legumes)', [[565, 65], [109, 12], [157, 12], [107, 11]], M.servir, 2),
  puchero_veg: d('vegetariano', 'Puchero vegetariano (grão-de-bico e legumes)', [['x:graodebico', 30], [91, 25], [109, 20], [64, 15], [107, 10]], M.servir, 2),
  vegetariano_generico: d('vegetariano', 'Prato vegetariano (genérico: PVT ao molho)', [['x:pvt', 70], [159, 20], [107, 10]], M.servir, 2),

  // guarnições
  macarrao_alho_oleo: d('guarnicao', 'Macarrão ao alho e óleo', [['x:macarrao', 92], [272, 5], [82, 3]], M.servir, 2, false),
  macarrao_primavera: d('guarnicao', 'Macarrão à primavera', [['x:macarrao', 70], [109, 10], [70, 10], [100, 10]], M.servir, 2),
  macarrao: d('guarnicao', 'Macarrão ao sugo', [['x:macarrao', 80], [159, 20]], M.servir, 2),
  nhoque: d('guarnicao', 'Nhoque ao sugo', [[136, 80], [159, 20]], M.servir, 2),
  pure_batata: d('guarnicao', 'Purê de batata', [[91, 80], ['x:leite', 15], [261, 5]], M.servir, 2),
  pure_mandioca: d('guarnicao', 'Purê de mandioca', [[129, 80], ['x:leite', 15], [261, 5]], M.servir, 2),
  pure_mandioquinha: d('guarnicao', 'Purê de mandioquinha', [[86, 80], ['x:leite', 15], [261, 5]], M.servir, 2),
  virado_legumes: d('guarnicao', 'Virado de legumes (farinha de mandioca e legumes)', [[122, 30], [109, 35], [45, 35]], M.legume, 2),
  farinha_mandioca: d('guarnicao', 'Farinha de mandioca torrada', [[122, 100]], M.colherSopa(10), 1, false),
  escarola_refogada: d('guarnicao', 'Escarola refogada', [['x:escarola-refogada', 100]], M.legume, 2, false),
  catalonha_refogada: d('guarnicao', 'Catalonha refogada', [[106, 100]], M.legume, 2, false),
  polenta_frita: d('guarnicao', 'Polenta frita', [[62, 85], [272, 15]], M.un('pedaço', 40), 3, false),
  polenta: d('guarnicao', 'Polenta', [[62, 100]], M.servir, 2),
  batata_palha: d('guarnicao', 'Batata palha', [[90, 100]], M.colherSopa(8), 4, false),
  batata_frita: d('guarnicao', 'Batata frita', [[93, 100]], M.servir, 2, false),
  batata_doce: d('guarnicao', 'Batata-doce cozida/corada', [[88, 100]], M.servir, 2),
  batata_corada: d('guarnicao', 'Batata corada/sauté', [[94, 100]], M.servir, 2),
  batata: d('guarnicao', 'Batata cozida', [[91, 100]], M.servir, 2),
  mandioca_frita: d('guarnicao', 'Mandioca frita', [[132, 100]], M.servir, 2, false),
  mandioca: d('guarnicao', 'Mandioca cozida', [[129, 100]], M.servir, 2),
  farofa: d('guarnicao', 'Farofa de mandioca', [[131, 100]], M.colherSopa(15), 2, false),
  cuscuz: d('guarnicao', 'Cuscuz paulista', [[534, 100]], M.servir, 2),
  yakisoba: d('guarnicao', 'Yakisoba', [[556, 100]], M.servir, 3),
  ervilha_parmentier: d('guarnicao', 'Ervilha à parmentier', [[560, 50], [91, 40], [261, 3], [107, 7]], M.legume, 2),
  ervilha: d('guarnicao', 'Ervilha', [[560, 100]], M.legume, 2),
  creme_milho: d('guarnicao', 'Creme de milho', [[45, 50], ['x:leite', 40], [42, 4], [261, 3], [107, 3]], M.servir, 2),
  milho: d('guarnicao', 'Milho verde', [[45, 100]], M.legume, 2),
  legumes: d('guarnicao', 'Legumes refogados', [[109, 30], [70, 25], [118, 20], [162, 15], [107, 10]], M.legume, 2),
  repolho: d('guarnicao', 'Repolho refogado', [[149, 85], [110, 10], [82, 2], [107, 3]], M.legume, 2),
  cenoura: d('guarnicao', 'Cenoura cozida', [[109, 95], [153, 5]], M.legume, 2),
  abobrinha: d('guarnicao', 'Abobrinha refogada', [[72, 90], [157, 10]], M.legume, 2),
  abobora_cabotia: d('guarnicao', 'Abóbora cabotiá cozida', [[64, 100]], M.legume, 2),
  abobora: d('guarnicao', 'Abóbora refogada', [[68, 100]], M.legume, 2),
  berinjela: d('guarnicao', 'Berinjela refogada', [[95, 85], [157, 10], [107, 5]], M.legume, 2),
  brocolis: d('guarnicao', 'Brócolis (alho, salsa e azeite)', [[100, 95], [82, 2], [260, 3]], M.legume, 2, false),
  couve_flor: d('guarnicao', 'Couve-flor cozida', [[118, 100]], M.legume, 2),
  couve: d('guarnicao', 'Couve refogada', [[116, 100]], M.legume, 2, false),
  espinafre: d('guarnicao', 'Espinafre refogado', [[120, 100]], M.legume, 2, false),
  chuchu: d('guarnicao', 'Chuchu cozido', [[112, 100]], M.legume, 2),
  vagem: d('guarnicao', 'Vagem', [[162, 100]], M.legume, 2),
  quiabo: d('guarnicao', 'Quiabo', [[147, 100]], M.legume, 2),
  jilo: d('guarnicao', 'Jiló', [[127, 100]], M.legume, 2),
  acelga_refogada: d('guarnicao', 'Acelga refogada', [[74, 100]], M.legume, 2),
  maionese_legumes: d('guarnicao', 'Salada de legumes com maionese', [[545, 100]], M.legume, 2, false),
  salpicao: d('guarnicao', 'Salpicão de frango', [[547, 100]], M.legume, 2, false),
  guarnicao_generica: d('guarnicao', 'Guarnição (genérico: legumes refogados)', [[109, 30], [70, 25], [118, 20], [162, 15], [107, 10]], M.legume, 2),

  // saladas (cruas, sem tempero)
  salada_mix: d('salada', 'Saladas diversas (folhas, tomate, cenoura, pepino)', [[78, 30], [157, 25], [110, 20], [142, 15], [149, 10]], [['porção', 60], ['pegador', 15], g], 1, false),
  alface: d('salada', 'Alface crespa', [[78, 100]], M.salada, 1, false),
  acelga: d('salada', 'Acelga crua', [[74, 100]], M.salada, 1, false),
  almeirao: d('salada', 'Almeirão cru', [[84, 100]], M.salada, 1, false),
  escarola: d('salada', 'Escarola (chicória) crua', [[111, 100]], M.salada, 1, false),
  agriao: d('salada', 'Agrião cru', [[75, 100]], M.salada, 1, false),
  rucula: d('salada', 'Rúcula crua', [[152, 100]], M.salada, 1, false),
  repolho_cru: d('salada', 'Repolho cru', [[149, 100]], M.salada, 1, false),
  repolho_roxo: d('salada', 'Repolho roxo cru', [[150, 100]], M.salada, 1, false),
  couve_crua: d('salada', 'Couve crua', [[115, 100]], M.salada, 1, false),
  beterraba: d('salada', 'Beterraba cozida', [[97, 100]], M.salada, 1, false),
  cenoura_crua: d('salada', 'Cenoura ralada', [[110, 100]], M.salada, 1, false),
  tomate: d('salada', 'Tomate', [[157, 100]], M.salada, 1, false),
  pepino: d('salada', 'Pepino', [[142, 100]], M.salada, 1, false),
  vinagrete: d('salada', 'Vinagrete', [[157, 55], [107, 25], [144, 20]], M.salada, 1, false),
  tabule: d('salada', 'Tabule', [[549, 100]], M.salada, 1, false),
  broto: d('salada', 'Broto de feijão', [[125, 100]], M.salada, 1, false),
  palmito: d('salada', 'Palmito', [[139, 100]], M.salada, 1, false),
  salada_legumes: d('salada', 'Salada de legumes no vapor', [[546, 100]], M.salada, 1, false),
  catalonha: d('salada', 'Catalonha crua', [[105, 100]], M.salada, 1, false),
  abobrinha_crua: d('salada', 'Abobrinha crua', [[71, 100]], M.salada, 1, false),
  salada_soja: d('salada', 'Salada de soja em grão', [['x:soja', 60], [107, 20], [144, 20]], M.salada, 1, false),
  salada_leguminosa: d('salada', 'Salada de grãos (feijão/grão-de-bico)', [[565, 70], [107, 15], [157, 15]], M.salada, 1, false),
  molho_salada: d('salada', 'Molho de salada (azeite e vinagre)', [[260, 40], ['x:agua', 60]], M.colherSopa(15), 0, false),

  // frutas
  laranja: d('fruta', 'Laranja-pera', [[214, 100]], M.un('unidade', 140), 1, false),
  mexerica: d('fruta', 'Mexerica/tangerina', [[251, 100]], M.un('unidade', 110), 1, false),
  banana: d('fruta', 'Banana-prata', [[182, 100]], M.un('unidade', 65), 1, false),
  maca: d('fruta', 'Maçã fuji', [[222, 100]], M.un('unidade', 130), 1, false),
  pera: d('fruta', 'Pera', [[243, 100]], M.un('unidade', 130), 1, false),
  melao: d('fruta', 'Melão', [[236, 100]], M.un('fatia', 115), 1, false),
  melancia: d('fruta', 'Melancia', [[235, 100]], M.un('fatia', 200), 1, false),
  abacaxi: d('fruta', 'Abacaxi', [[164, 100]], M.un('fatia', 100), 1, false),
  mamao: d('fruta', 'Mamão formosa', [[225, 100]], M.un('fatia', 150), 1, false),
  goiaba: d('fruta', 'Goiaba', [[200, 100]], M.un('unidade', 110), 1, false),
  manga: d('fruta', 'Manga', [[231, 100]], M.un('fatia', 120), 1, false),
  uva: d('fruta', 'Uva', [[256, 100]], M.un('porção', 100), 1, false),
  kiwi: d('fruta', 'Kiwi', [[207, 100]], M.un('unidade', 75), 1, false),
  caqui: d('fruta', 'Caqui', [[189, 100]], M.un('unidade', 110), 1, false),
  ameixa: d('fruta', 'Ameixa', [[172, 100]], M.un('porção', 100), 1, false),
  morango: d('fruta', 'Morango', [[239, 100]], M.un('porção', 100), 1, false),
  pessego: d('fruta', 'Pêssego', [[244, 100]], M.un('unidade', 110), 1, false),
  maracuja: d('fruta', 'Maracujá', [[232, 100]], M.un('unidade', 120), 1, false),
  acerola: d('fruta', 'Acerola', [[169, 100]], M.un('porção', 100), 1, false),
  limao: d('fruta', 'Limão', [[220, 100]], M.un('unidade', 65), 1, false),
  salada_frutas: d('fruta', 'Salada de frutas', [[214, 25], [182, 25], [222, 25], [225, 25]], M.un('porção', 120), 1, false),
  fruta_generica: d('fruta', 'Fruta (genérico)', [[214, 50], [182, 50]], M.un('unidade', 100), 1, false),

  // doces
  doce_leite: d('doce', 'Doce de leite', [[501, 100]], M.un('porção', 30), 1, false),
  cocada: d('doce', 'Cocada', [[499, 100]], M.un('unidade', 30), 1, false),
  bananada: d('doce', 'Bananada', [[176, 100]], M.un('unidade', 25), 1, false),
  goiabada: d('doce', 'Goiabada', [[198, 100]], M.un('fatia', 30), 1, false),
  pacoca: d('doce', 'Paçoca', [[579, 100]], M.un('unidade', 20), 1, false),
  pe_moleque: d('doce', 'Pé-de-moleque', [[580, 100]], M.un('unidade', 25), 1, false),
  torrone: d('doce', 'Torrone', [['x:torrone', 100]], M.un('unidade', 25), 1, false),
  maria_mole: d('doce', 'Maria-mole', [[504, 100]], M.un('unidade', 30), 1, false),
  marmelada: d('doce', 'Marmelada', [[506, 100]], M.un('fatia', 30), 1, false),
  doce_abobora: d('doce', 'Doce de abóbora', [[500, 100]], M.un('porção', 30), 1, false),
  quindim: d('doce', 'Quindim', [[509, 100]], M.un('unidade', 40), 1, false),
  chocolate: d('doce', 'Chocolate ao leite / bombom', [[495, 100]], M.un('unidade', 21), 1, false),
  pudim_pao: d('doce', 'Pudim de pão com calda', [[53, 20], [453, 22], ['x:leite', 35], [489, 13], [494, 10]], M.un('porção', 80), 1, false),
  pudim: d('doce', 'Pudim de leite', [[453, 30], ['x:leite', 45], [489, 15], [494, 10]], M.un('porção', 80), 1, false),
  mousse_chocolate: d('doce', 'Mousse de chocolate', [[453, 35], [447, 30], [491, 10], ['x:leite', 25]], M.un('porção', 70), 1, false),
  mousse_maracuja: d('doce', 'Mousse de maracujá', [[453, 35], [447, 30], [233, 35]], M.un('porção', 70), 1, false),
  mousse: d('doce', 'Mousse de fruta', [[453, 35], [447, 30], [239, 35]], M.un('porção', 70), 1, false),
  gelatina: d('doce', 'Gelatina', [['x:gelatina', 100]], M.un('porção', 100), 1, false),
  iogurte: d('doce', 'Iogurte de fruta', [[451, 100]], M.un('pote', 100), 1, false),
  arroz_doce: d('doce', 'Arroz-doce', [[3, 40], ['x:leite', 40], [494, 15], [453, 5]], M.un('porção', 100), 1, false),
  canjica: d('doce', 'Canjica', [[20, 100]], M.un('porção', 120), 1, false),
  manjar: d('doce', 'Manjar com calda', [['x:leite', 60], [523, 15], [42, 8], [494, 12], [171, 5]], M.un('porção', 90), 1, false),
  brigadeirao: d('doce', 'Brigadeirão', [[453, 40], [489, 15], [447, 15], [491, 10], ['x:leite', 20]], M.un('fatia', 70), 1, false),
  bolo_chocolate: d('doce', 'Bolo de chocolate', [[16, 100]], M.un('unidade', 50), 1, false),
  bolo_coco: d('doce', 'Bolo de coco', [[17, 100]], M.un('fatia', 60), 1, false),
  bolo: d('doce', 'Bolo simples (milho)', [[18, 100]], M.un('fatia', 60), 1, false),
  barra_cereal: d('doce', 'Barra de cereais', [['x:barra', 100]], M.un('unidade', 25), 1, false),
  picole: d('doce', 'Picolé/sorvete de creme', [['x:sorvete', 100]], M.un('unidade', 60), 1, false),
  sagu: d('doce', 'Sagu com suco de uva', [['x:sagu', 100]], M.un('porção', 100), 1, false),
  goiabinha: d('doce', 'Biscoito recheado de goiaba', [[8, 55], [198, 45]], M.un('unidade', 25), 1, false),
  romeu_julieta: d('doce', 'Romeu e Julieta (goiabada e queijo)', [[198, 60], [461, 40]], M.un('porção', 40), 1, false),
  doce_generico: d('doce', 'Doce (genérico: doce de leite)', [[501, 100]], M.un('porção', 30), 1, false),

  // pão e bebida
  minipao: d('pao', 'Minipão francês', [[53, 100]], M.un('unidade', 25), 0, false), // só entra por padrão em dia de hambúrguer (app.js)
  pao_integral: d('pao', 'Pão integral', [[52, 100]], M.un('unidade', 25), 0, false),
  refresco: d('bebida', 'Refresco adoçado', [['x:refresco', 100]], [['copo (200 ml)', 200], ['ml', 1]], 0, false),
  // refresco do bandejão: 53 kcal/200 ml com açúcar, ~39 kcal/200 ml sem
  refresco_zero: d('bebida', 'Refresco sem açúcar', [['x:refresco-zero', 100]], [['copo (200 ml)', 200], ['ml', 1]], 0, false),
  suco_laranja: d('bebida', 'Suco de laranja natural', [[215, 100]], [['copo (200 ml)', 200], ['ml', 1]], 0, false),
  cafe: d('bebida', 'Café sem açúcar', [[471, 100]], [['xícara (50 ml)', 50], ['ml', 1]], 0, false),
};

// ---------------------------------------------------------------------------
// Regras texto → prato. Primeira que casar vence, então o mais específico vem antes.
// O texto é comparado sem acentos e em minúsculas.
const RULES = [
  // salgados que começam como doce ("bolinho de ricota")
  [/bolinho de (ricota|queijo)/, 'bolinho_ricota'],
  [/bolinho de arroz/, 'bolinho_arroz'],
  [/^molho\b/, 'molho_salada'],

  // saladas ("salada de X", "saladas: diversas") — antes de soja/legumes
  [/salada de frutas/, 'salada_frutas'],
  [/^saladas?:?\s*(diversas|mista|variadas|verdes?|do dia)?$|^diversas$|^saladas? (mista|diversas|variadas|verde)/, 'salada_mix'],
  [/salada.*soja/, 'salada_soja'],
  [/salada.*(feijao|grao de bico|lentilha)/, 'salada_leguminosa'],
  [/salada de batata|maionese/, 'maionese_legumes'],
  [/salada.*legumes/, 'salada_legumes'],
  [/salada.*alface/, 'alface'],
  [/salada.*acelga/, 'acelga'],
  [/salada.*almeirao/, 'almeirao'],
  [/salada.*(escarola|chicoria)/, 'escarola'],
  [/salada.*(catalonha|catalonia)/, 'catalonha'],
  [/salada.*agriao/, 'agriao'],
  [/salada.*rucula/, 'rucula'],
  [/salada.*repolho roxo/, 'repolho_roxo'],
  [/salada.*repolho/, 'repolho_cru'],
  [/salada.*couve/, 'couve_crua'],
  [/salada.*beterraba/, 'beterraba'],
  [/salada.*cenoura/, 'cenoura_crua'],
  [/salada.*abobrinha/, 'abobrinha_crua'],
  [/salada.*tomate/, 'tomate'],
  [/salada.*pepino/, 'pepino'],
  [/salada.*broto/, 'broto'],
  [/salada.*palmito/, 'palmito'],
  [/^vinagrete$|salada.*vinagrete|molho vinagrete/, 'vinagrete'],
  [/tabule/, 'tabule'],
  [/^salada/, 'salada_mix'],

  // doces que contêm nomes de frutas/legumes/pão
  [/bananada/, 'bananada'],
  [/goiabinha/, 'goiabinha'],
  [/romeu e julieta/, 'romeu_julieta'],
  [/sagu/, 'sagu'],
  [/doce de leite/, 'doce_leite'],
  [/doce de abobora/, 'doce_abobora'],
  [/goiabada/, 'goiabada'],
  [/pudim de pao/, 'pudim_pao'],
  [/pudim/, 'pudim'],
  [/mousse.*chocolate/, 'mousse_chocolate'],
  [/mousse.*maracuja/, 'mousse_maracuja'],
  [/mousse/, 'mousse'],
  [/gelatina/, 'gelatina'],
  [/iogurte/, 'iogurte'],
  [/salada de frutas/, 'salada_frutas'],
  [/arroz doce/, 'arroz_doce'],
  [/canjica|curau/, 'canjica'],
  [/manjar/, 'manjar'],
  [/brigadeir/, 'brigadeirao'],
  [/bolo.*chocolate|bolinho.*chocolate|roll.*chocolate|brownie/, 'bolo_chocolate'],
  [/bolo.*coco/, 'bolo_coco'],
  [/\bbolo\b|bolinho|rocambole|\broll\b/, 'bolo'],
  [/cocada/, 'cocada'],
  [/pacoca/, 'pacoca'],
  [/pe de moleque/, 'pe_moleque'],
  [/torrone/, 'torrone'],
  [/maria mole/, 'maria_mole'],
  [/marmelada/, 'marmelada'],
  [/quindim/, 'quindim'],
  [/picole|sorvete/, 'picole'],
  [/chocolate|bombom|ouro branco|sonho de valsa|bis\b/, 'chocolate'],
  [/barra de cerea|barrinha/, 'barra_cereal'],
  [/^doce|sobremesa/, 'doce_generico'],

  // vegetarianos (antes das carnes: "hambúrguer de PVT", "quibe de PVT"...)
  [/batata recheada/, 'batata_recheada_pvt'],
  [/croquete de (pvt|pts|soja)/, 'croquete_pvt'],
  [/hamburguer de (pvt|pts|soja)/, 'hamburguer_pvt'],
  [/quibe de (pvt|pts|soja|abobora)/, 'quibe_pvt'],
  [/escondidinho de (pvt|pts|soja|legumes)/, 'escondidinho_pvt'],
  [/torta.*(pvt|pts|soja)|(pvt|pts|soja).*torta/, 'torta_pvt'],
  [/estrogonofe de (pvt|pts|soja)/, 'estrogonofe_pvt'],
  [/(pvt|pts|proteina de soja|soja texturizada).*azeitona/, 'pvt_azeitona'],
  [/(pvt|pts|proteina de soja|soja texturizada).*(legume|batata)/, 'pvt_legumes'],
  [/lasanha.*(pvt|pts|soja)/, 'lasanha_legumes'],
  [/\b(pvt|pts)\b|proteina (texturizada|de soja)|soja texturizada/, 'pvt'],
  [/cass?oulet|cassulet/, 'cassoulet_veg'],
  [/puchero/, 'puchero_veg'],
  [/hamburguer de lentilha/, 'hamburguer_lentilha'],
  [/lentilha.*berinjela/, 'lentilha_berinjela'],
  [/lentilha/, 'lentilha'],
  [/grao de bico|falafel/, 'graodebico'],
  [/soja/, 'soja'],
  [/tofu/, 'tofu'],
  [/parmegiana de berinjela|berinjela a parmegiana/, 'parmegiana_berinjela'],
  [/lasanha.*(brocolis|abobrinha|legume|espinafre|berinjela|vegetariana|queijo)/, 'lasanha_legumes'],
  [/tomate recheado/, 'tomate_recheado'],
  [/paella/, 'paella'],
  [/(creme|sopa) de ervilha/, 'creme_ervilha'],
  [/estrogonofe de (legumes|cogumelo|palmito)/, 'estrogonofe_legumes'],
  [/batatalhoada/, 'batatalhoada'],
  [/omelete|fritada|tortilha/, 'omelete'],
  [/ovos? mexidos?/, 'ovo_mexido'],
  [/ovos? (frito|estrelado)/, 'ovo_frito'],
  [/ovos? (cozido|coradinho)|^ovos?$/, 'ovo_cozido'],

  // carnes
  [/(mandioca|aipim|macaxeira) ensopad/, 'mandioca'], // senão "ensopad" vira carne em cubos
  [/feijoada/, 'feijoada'],
  [/carreteiro/, 'carreteiro'],
  [/escondidinho/, 'escondidinho_carne'],
  [/almondega de (pvt|pts|soja|ervilha|lentilha|legume|grao)/, 'pvt'],
  [/frango.*passarinho/, 'frango_passarinho'],
  [/frango.*(empanado|milanesa)|(empanado|milanesa).*frango|nuggets?/, 'frango_empanado'],
  [/fricasse/, 'frango_fricasse'],
  [/estrogonofe de frango/, 'frango_estrogonofe'],
  [/frango.*(shoyu|xadrez|teriyaki|agridoce)/, 'frango_shoyu'],
  [/frango.*(grelhado|chapa)|file de frango$/, 'frango_grelhado'],
  [/frango.*(assad|forno|coxa|sobrecoxa|tulipa|caipira)|\b(file de )?(coxa|sobrecoxa)\b/, 'frango_assado'],
  [/frango.*(tiras|cubos|molho|desfiado|ensopado|cozido|acebolado|refogado|curry|xadrez)/, 'frango_molho'],
  [/frango|galinha|chester|peru\b/, 'frango'],
  [/estrogonofe/, 'carne_estrogonofe'],
  [/almondega/, 'almondega'],
  [/hamburguer|hamburger/, 'hamburguer'],
  [/escondidinho|madalena|torta de carne/, 'escondidinho_carne'],
  [/lasanha|bolonhesa/, 'lasanha_carne'],
  [/quibe.*frito|kibe.*frito/, 'quibe_frito'],
  [/quibe|kibe/, 'quibe'],
  [/carne moida|moida/, 'carne_moida'],
  [/carne seca|charque|jerked/, 'carne_seca'],
  [/carne louca|desfiad/, 'carne_desfiada'],
  [/lagarto|carne assada|rosbife/, 'carne_assada'],
  [/cupim/, 'cupim'],
  [/(contra ?file|carne|alcatra).*tiras|tiras de (carne|contra ?file)/, 'carne_tiras'],
  [/bife de cacarola|cacarola|carne de panela/, 'bife_cacarola'],
  [/bife.*acebolado|acebolado.*bife/, 'bife_acebolado'],
  [/bife.*molho|bife a /, 'bife_molho'],
  [/bife|bisteca bovina|contra ?file|alcatra|file mignon|patinho|picanha|maminha|fraldinha/, 'bife'],
  [/cubos|picadinho|ensopad|goulash|iscas|tiras de carne|carne.*molho|cozido de carne|vaca atolada|panelada/, 'carne_cubos'],
  [/lombo/, 'lombo'],
  [/pernil/, 'pernil'],
  [/bisteca|costelinha suina|copa lombo/, 'bisteca'],
  [/linguica|salsicha/, 'linguica'],
  [/costela/, 'costela'],
  [/suin[ao]|porco/, 'suino'],
  [/peixe.*(frito|empanado|milanesa)|(merluza|pescada|tilapia|polaca|cacao).*(frit|empanad|milanesa)|isca de peixe/, 'peixe_frito'],
  [/peixe|merluza|pescada|tilapia|polaca|cacao|sardinha|atum|saint peter|panga/, 'peixe'],

  // guarnições
  [/batata palha/, 'batata_palha'],
  [/macarrao.*alho e oleo|espaguete.*alho e oleo/, 'macarrao_alho_oleo'],
  [/macarrao.*primavera|penne.*primavera/, 'macarrao_primavera'],
  [/macarrao|espaguete|penne|parafuso|talharim|massa|fusilli|ravioli|capeletti/, 'macarrao'],
  [/nhoque/, 'nhoque'],
  [/pure de batata|batata.*pure/, 'pure_batata'],
  [/pure de (mandioca|aipim|macaxeira)/, 'pure_mandioca'],
  [/pure de (mandioquinha|batata baroa|batata salsa)/, 'pure_mandioquinha'],
  [/polenta frita/, 'polenta_frita'],
  [/polenta|angu/, 'polenta'],
  [/batata doce/, 'batata_doce'],
  [/batata frita|batata canoa|batata rustica frita|fritas/, 'batata_frita'],
  [/batata.*(corada|saute|assada|rustica|dore|ao murro|calabresa)/, 'batata_corada'],
  [/\bbatata\b/, 'batata'],
  [/mandioca frita|aipim frito/, 'mandioca_frita'],
  [/farinha de mandioca/, 'farinha_mandioca'],
  [/farofa/, 'farofa'],
  [/mandioca|aipim|macaxeira/, 'mandioca'],
  [/cuscuz/, 'cuscuz'],
  [/yakisoba/, 'yakisoba'],
  [/tropeiro/, 'tropeiro'],
  [/baiao/, 'baiao'],
  [/virado (de|com) /, 'virado_legumes'],
  [/virado/, 'virado'],
  [/arroz (a )?grega|arroz colorido|arroz primavera/, 'arroz_grega'],
  [/ervilha.*parmentier|parmentier/, 'ervilha_parmentier'],
  [/creme de milho|milho cremoso/, 'creme_milho'],
  [/salpicao/, 'salpicao'],
  [/(escarola|chicoria) refogada/, 'escarola_refogada'],
  [/(catalonha|catalonia) refogada/, 'catalonha_refogada'],

  // legumes
  [/legumes|jardineira|seleta|saute|ratatouille|caponata/, 'legumes'],
  [/repolho/, 'repolho'],
  [/cenoura/, 'cenoura'],
  [/abobrinha/, 'abobrinha'],
  [/cabotia|cabotian|japonesa/, 'abobora_cabotia'],
  [/abobora|moranga|quibebe/, 'abobora'],
  [/berinjela/, 'berinjela'],
  [/brocolis/, 'brocolis'],
  [/couve flor/, 'couve_flor'],
  [/couve/, 'couve'],
  [/espinafre/, 'espinafre'],
  [/chuchu/, 'chuchu'],
  [/vagem/, 'vagem'],
  [/quiabo/, 'quiabo'],
  [/jilo/, 'jilo'],
  [/acelga/, 'acelga_refogada'],
  [/ervilha/, 'ervilha'],
  [/milho/, 'milho'],

  // folhas e legumes crus soltos (geralmente listados sob "Saladas")
  [/alface/, 'alface'],
  [/almeirao/, 'almeirao'],
  [/escarola|chicoria/, 'escarola'],
  [/catalonha|catalonia/, 'catalonha'],
  [/agriao/, 'agriao'],
  [/rucula/, 'rucula'],
  [/beterraba/, 'beterraba'],
  [/pepino/, 'pepino'],
  [/tomate/, 'tomate'],
  [/palmito/, 'palmito'],

  // bebidas antes das frutas, para "Suco de laranja/abacaxi" não virar fruta
  [/suco de laranja natural|suco natural/, 'suco_laranja'],
  [/\bsuco\b|refresco|refrigerante/, 'refresco'],

  // frutas
  [/laranja/, 'laranja'],
  [/mexerica|tangerina|ponkan|pokan|bergamota/, 'mexerica'],
  [/banana/, 'banana'],
  [/maca\b|maca /, 'maca'],
  [/pera\b/, 'pera'],
  [/melancia/, 'melancia'],
  [/melao/, 'melao'],
  [/abacaxi/, 'abacaxi'],
  [/mamao/, 'mamao'],
  [/goiaba/, 'goiaba'],
  [/manga\b/, 'manga'],
  [/uva/, 'uva'],
  [/kiwi/, 'kiwi'],
  [/caqui/, 'caqui'],
  [/ameixa/, 'ameixa'],
  [/morango/, 'morango'],
  [/pessego/, 'pessego'],
  [/maracuja/, 'maracuja'],
  [/acerola/, 'acerola'],
  [/limao/, 'limao'],
  [/fruta/, 'fruta_generica'],

  // base, pão e bebida
  [/pao integral/, 'pao_integral'],
  [/arroz integral|^integral$/, 'arroz_integral'],
  [/^arroz/, 'arroz'],
  [/feijao preto/, 'feijao_preto'],
  [/feijao/, 'feijao'],
  [/pao de mel|minibolo|mini bolo/, 'bolo'],
  [/mini ?pao|pao/, 'minipao'],
  [/suco de laranja natural|suco natural/, 'suco_laranja'],
  [/suco|refresco|refrigerante|bebida/, 'refresco'],
  [/cafe\b/, 'cafe'],
];

// ---------------------------------------------------------------------------
// Receitas vistas no cartaz de ingredientes do bandejão (public/receitas.json). Cada uma refina
// um prato que já existe (mesma chave) ou cria um novo, herdando medidas/quantidade de `base`.
// Os valores continuam vindo da TACO/TBCA: do cartaz só se usam os ingredientes.
// Chamar antes de createDb (o cálculo por 100 g fica em cache).
// Tipos em que as kcal do cartaz valem. Pão, arroz, feijão (base) e fruta ficam sempre pela TACO;
// suco e picolé têm valor fixo medido no bandejão.
export const KCAL_CARTAZ_KINDS = ['proteina', 'vegetariano', 'guarnicao', 'salada', 'doce'];

export function applyReceitas(data) {
  const rules = [];
  for (const r of data?.receitas ?? []) {
    const from = DISHES[r.chave] ?? DISHES[r.base];
    const kind = r.tipo ?? from?.kind;
    const units = r.medidas ?? from?.units;
    const comp = r.composicao ?? from?.comp;
    if (!r.chave || !kind || !units || !comp?.length) continue; // incompleta: ignora em vez de quebrar o app
    // kcal do cartaz ({ kcal, g }: kcal informadas para g gramas): passam a ser as kcal por grama do
    // prato (a porção continua a do app) e a composição TACO dá só a proporção dos macros. O +10% de
    // gordura do preparo vale também aqui: o cartaz ainda deixa gordura de fora.
    const kcal100 = KCAL_CARTAZ_KINDS.includes(kind) && r.cartaz?.kcal > 0 && r.cartaz?.g > 0
      ? (r.cartaz.kcal / r.cartaz.g) * 100 : null;
    DISHES[r.chave] = {
      ...d(kind, r.nome ?? from.label, comp, units, r.qtd ?? from?.qty ?? 1, kcal100 ? true : r.oleo ?? from?.oleo ?? true),
      cartaz: r.ingredientes ?? null,
      kcal100,
    };
    for (const t of r.texto ?? []) {
      try { rules.push([new RegExp(t), r.chave]); } catch { /* regex inválida: só não casa */ }
    }
  }
  RULES.unshift(...rules); // regras das receitas vêm antes das genéricas
}

export const norm = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();

export function matchDish(text) {
  const t = norm(text);
  for (const [re, key] of RULES) if (re.test(t)) return key;
  return null;
}

// ---------------------------------------------------------------------------
// Parser do texto do cardápio. Lida com os dois formatos que a USP usa:
//   SP:  "Arroz/feijão/arroz integral\nFrango empanado\nOpção: Creme de ervilha\n..."
//   SC:  "Arroz/Feijão/ Arroz integral/\nSaladas: Diversas/\n...\nSobremesa: Iogurte/Laranja/\nMini Pão e Suco"
const LABEL = /^(op[cç][aã]o(?: vegetariana| vegana| (?:do )?prato principal)?|prato principal|sobremesas?|saladas?|guarni[cç][aã]o|acompanhamentos?|bebidas?|sucos?|refrescos?)\s*:\s*/i;

// limpeza antes de quebrar em "/": "c/" vira "com", alergênicos e kcal saem do texto
function preclean(raw) {
  let kcal = null;
  const text = raw
    .replace(/(\d{3,4})\s*kcal/gi, (_, n) => { kcal = Number(n); return ''; })
    .replace(/\((?:cont[eé]m|pode conter)[^)]*\)?/gi, '')
    .replace(/\bcont[eé]m\s+(?:lactose|gl[uú]ten|ovos?|soja|leite|trigo)(?:\s*(?:e|,|\/)\s*(?:lactose|gl[uú]ten|ovos?|soja|leite|trigo))*/gi, '')
    .replace(/(^|\s)([cs])\/\s*/gi, (_, pre, l) => pre + (l.toLowerCase() === 'c' ? 'com ' : 'sem '));
  return { text, kcal };
}

function labelRole(label) {
  const l = norm(label);
  if (l.startsWith('opcao')) return 'vegetariano';
  if (l.startsWith('sobremesa')) return 'sobremesa';
  if (l.startsWith('salada')) return 'salada';
  if (l.startsWith('guarni') || l.startsWith('acompanha')) return 'guarnicao';
  if (l.startsWith('bebida') || l.startsWith('suco') || l.startsWith('refresco')) return 'bebida';
  return 'principal';
}

// protege "/" dentro de parênteses para não quebrar "Frango (Coxa/Sobrecoxa)"
const SLASH = '⁄';
const protectParens = (s) => s.replace(/\([^)]*\)/g, (m) => m.replace(/\//g, SLASH));
const restoreSlash = (s) => s.replace(new RegExp(SLASH, 'g'), '/');

const KIND_ROLE = {
  base: 'base', proteina: 'principal', vegetariano: 'vegetariano', guarnicao: 'guarnicao',
  salada: 'salada', fruta: 'sobremesa', doce: 'sobremesa', pao: 'pao', bebida: 'bebida',
};

export const ROLE_TITLE = {
  base: 'Base', prato: 'Prato principal', guarnicao: 'Guarnição', salada: 'Salada',
  sobremesa: 'Sobremesa', acomp: 'Pão e bebida',
};

export function parseMenu(text) {
  const trimmed = (text || '').trim();
  if (!trimmed || /^fechado\b/i.test(trimmed)) return { closed: true, items: [] };
  const { text: raw, kcal } = preclean(trimmed);

  // quebra em partes por linha e por "/", preservando o rótulo da linha/parte
  const parts = [];
  for (const line of raw.split(/\r?\n/)) {
    let lineLabel = null;
    let rest = line.trim();
    const m = rest.match(LABEL);
    if (m) { lineLabel = m[1]; rest = rest.slice(m[0].length); }
    for (let piece of protectParens(rest).split('/')) {
      piece = restoreSlash(piece).trim().replace(/[.;,]+$/, '');
      if (!piece) continue;
      let label = lineLabel;
      const pm = piece.match(LABEL);
      if (pm) { label = pm[1]; piece = piece.slice(pm[0].length).trim(); }
      // "Mini Pão e Suco" → dois itens
      const combo = piece.match(/^(mini ?p[aã]o)\s+e\s+(suco|refresco)$/i);
      if (combo) { parts.push({ text: combo[1], label }, { text: combo[2], label }); continue; }
      if (piece) parts.push({ text: piece, label });
    }
  }

  const items = [];
  let principalSeen = false;
  parts.forEach((p, i) => {
    const text = p.text;
    const roleFromLabel = p.label ? labelRole(p.label) : null;
    // "Saladas: Diversas" → texto "Diversas" com rótulo de salada
    const matched = matchDish(roleFromLabel === 'salada' ? `salada ${text}` : text);
    let key = matched;
    let role;
    if (key) {
      const kind = DISHES[key].kind;
      // rótulo explícito manda sobre o tipo do prato ("Prato principal: Lasanha à bolonhesa"
      // não é sobremesa; "Guarnição: Creme de ervilha" não disputa o prato principal)
      if (roleFromLabel) {
        role = roleFromLabel;
        // "Bebida/Suco: Abacaxi" é refresco, não a fruta
        if (roleFromLabel === 'bebida' && kind !== 'bebida') key = 'refresco';
      } else {
        role = KIND_ROLE[kind];
      }
    } else {
      role = roleFromLabel || (!principalSeen ? 'principal' : 'guarnicao');
      key = {
        principal: 'carne_generica', vegetariano: 'vegetariano_generico', sobremesa: 'doce_generico',
        salada: 'salada_mix', bebida: 'refresco', pao: 'minipao',
      }[role] || 'guarnicao_generica';
    }
    if (role === 'principal') principalSeen = true;
    const group = role === 'principal' || role === 'vegetariano' ? 'prato'
      : role === 'pao' || role === 'bebida' ? 'acomp' : role;
    const shown = roleFromLabel === 'salada' && !/salada/i.test(text) && /^(diversas|mista|variadas|verdes?)$/i.test(text)
      ? `Saladas ${text.toLowerCase()}` : text;
    // molho extra só faz sentido no prato principal
    const sauce = group === 'prato' ? sauceType(text) : null;
    items.push({ id: `i${i}`, text: tidy(shown), key, role, group, generic: !matched, sauce });
  });
  return { closed: items.length === 0, items, kcal };
}

const tidy = (s) => s.charAt(0).toUpperCase() + s.slice(1).replace(/\s+/g, ' ');

// Grupos de escolha única: arroz (branco × integral), prato (carne × opção), sobremesa (doce × fruta).
export function choiceGroups(items) {
  const groups = {};
  const arroz = items.filter((it) => it.key === 'arroz' || it.key === 'arroz_integral');
  if (arroz.length > 1) groups.arroz = arroz.map((it) => it.id);
  const prato = items.filter((it) => it.group === 'prato');
  if (prato.length > 1) groups.prato = prato.map((it) => it.id);
  const sobremesa = items.filter((it) => it.group === 'sobremesa');
  if (sobremesa.length > 1) groups.sobremesa = sobremesa.map((it) => it.id);
  return groups;
}

// ---------------------------------------------------------------------------
// Cálculo

export function createDb(taco) {
  const byId = new Map(taco.map((f) => [f.id, f]));
  const cache = new Map();

  function ingredient(ref) {
    if (typeof ref === 'number') return byId.get(ref);
    const x = EXTRAS[ref];
    if (!x) return undefined;
    if (!x.from) return x;
    const acc = { n: x.n, k: 0, p: 0, c: 0, g: 0, f: 0 };
    for (const [id, factor] of x.from) {
      const f = byId.get(id);
      for (const m of ['k', 'p', 'c', 'g', 'f']) acc[m] += f[m] * factor;
    }
    return acc;
  }

  // composição por 100 g de um prato (ou de um alimento TACO escolhido pela pessoa)
  function per100(dishOrTacoId) {
    if (cache.has(dishOrTacoId)) return cache.get(dishOrTacoId);
    const comp = typeof dishOrTacoId === 'number' ? [[dishOrTacoId, 100]] : DISHES[dishOrTacoId].comp;
    const total = comp.reduce((s, [, w]) => s + w, 0);
    const acc = { k: 0, p: 0, c: 0, g: 0, f: 0, sources: [] };
    for (const [ref, w] of comp) {
      const f = ingredient(ref);
      if (!f) throw new Error(`ingrediente ausente: ${ref}`);
      for (const m of ['k', 'p', 'c', 'g', 'f']) acc[m] += (f[m] * w) / total;
      acc.sources.push({ n: f.n, pct: Math.round((w / total) * 100), taco: typeof ref === 'number', tbca: f.tbca ?? null });
    }
    // kcal do cartaz do bandejão: o total vem dele e os macros acompanham na mesma proporção
    // (a diferença costuma ser água que evaporou ou sobrou no preparo)
    const kcal100 = typeof dishOrTacoId === 'string' ? DISHES[dishOrTacoId].kcal100 : null;
    if (kcal100 && acc.k > 0) {
      const factor = kcal100 / acc.k;
      for (const m of ['k', 'p', 'c', 'g', 'f']) acc[m] *= factor;
      acc.cartaz = { factor };
    }
    cache.set(dishOrTacoId, acc);
    return acc;
  }

  // nutrientes de um item com porção; `ajuste` = fração extra de kcal vinda de gordura (0.10)
  function nutrients({ base, grams, oleo }, ajuste) {
    const n = per100(base);
    const r = grams / 100;
    const out = { kcal: n.k * r, p: n.p * r, c: n.c * r, g: n.g * r, f: n.f * r, extra: 0 };
    if (oleo && ajuste > 0) {
      out.extra = out.kcal * ajuste;
      out.kcal += out.extra;
      out.g += out.extra / 9;
    }
    return out;
  }

  return { byId, per100, nutrients, ingredient };
}
