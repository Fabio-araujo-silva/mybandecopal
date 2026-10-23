import { DISHES, ROLE_TITLE, choiceGroups, createDb, norm, parseMenu } from './nutrition.js';

const DEFAULT_RESTAURANT = { id: '2', name: 'Área 1 · São Carlos' };
const AJUSTE_BANDEJAO = 0.10;
const SECTION_ORDER = ['base', 'prato', 'guarnicao', 'salada', 'sobremesa', 'acomp'];
const $ = (sel) => document.querySelector(sel);

// localStorage só guarda conveniências desta pessoa; tudo funciona sem ele
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(`bandejao:${key}`); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`bandejao:${key}`, JSON.stringify(value)); } catch { /* modo privado */ }
  },
};

// estatísticas de uso anônimas para a página /admin: um id aleatório por navegador,
// nenhum dado pessoal, nenhum IP. Fire-and-forget: nunca quebra a página.
const visitorId = (() => {
  let v = store.get('vid', null);
  if (!v) { v = (crypto.randomUUID?.() || String(Math.random()).slice(2) + Date.now().toString(36)); store.set('vid', v); }
  return v;
})();
const isMobile = matchMedia('(max-width: 640px)').matches || /Mobi|Android/i.test(navigator.userAgent);
function beacon(event) {
  try {
    const body = JSON.stringify({ ...event, vid: visitorId });
    if (navigator.sendBeacon) navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }));
    else fetch('/api/track', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } });
  } catch { /* sem telemetria, tudo bem */ }
}
const track = {
  view: () => beacon({ type: 'view', device: isMobile ? 'mobile' : 'desktop', restaurant: state.restaurant.id, meal: state.meal }),
  meal: () => beacon({ type: 'meal', restaurant: state.restaurant.id, meal: state.meal }),
  choice: (group, value) => beacon({ type: 'choice', group, value }),
  portion: (dish, grams, def) => beacon({ type: 'portion', dish, grams, def }),
  swap: (dish, taco) => beacon({ type: 'swap', dish, taco }),
};

const state = {
  db: null,
  taco: [],
  restaurant: store.get('restaurant', DEFAULT_RESTAURANT),
  restaurants: null,
  menu: null,
  dayIdx: 0,
  meal: 'lunch',
  parsed: null,
  selected: {},
  portions: store.get('portions-v3', {}), // { "restaurante|dd/mm/aaaa|lunch": { prato: { u, q } } }
  overrides: store.get('overrides', {}),
  ratings: store.get('ratings', {}), // { "frango à passarinho": 4 } — a nota segue o prato
  sugarFree: store.get('sugarFree', false),
  choicePrefs: store.get('choices', {}),
  adjust: store.get('adjust', true),
  expanded: new Set(),
  error: null,
};

// ---------------------------------------------------------------- utilidades
const fmt = (n, d = 0) => n.toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d });
const fmtQty = (q) => (Number.isInteger(q) ? String(q) : q.toLocaleString('pt-BR', { maximumFractionDigits: 1 }));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PLURAL = {
  colher: 'colheres', concha: 'conchas', unidade: 'unidades', 'pedaço': 'pedaços', bife: 'bifes', 'filé': 'filés',
  fatia: 'fatias', 'porção': 'porções', pegador: 'pegadores', ovo: 'ovos', gomo: 'gomos', pote: 'potes', copo: 'copos', 'xícara': 'xícaras',
  'hambúrguer': 'hambúrgueres', 'almôndega': 'almôndegas', quibe: 'quibes', bifinho: 'bifinhos', croquete: 'croquetes',
  bolinho: 'bolinhos', omelete: 'omeletes', tomate: 'tomates', batata: 'batatas', bisteca: 'bistecas',
};
// rótulos curtos para caber ao lado dos macros; os gramas aparecem na linha do nome
const SHORT = {
  'colher de servir': 'col. servir', 'colher de sopa': 'col. sopa', unidade: 'unid.',
  'copo (200 ml)': 'copo', 'xícara (50 ml)': 'xícara',
};
function unitLabel(name, q) {
  const short = SHORT[name];
  if (short) return short === 'copo' || short === 'xícara' ? unitLabel(short, q) : short;
  if ((q > 0 && q <= 1) || name === 'g' || name === 'ml') return name; // "0,5 concha", "1,5 conchas"
  const [first, ...rest] = name.split(' ');
  return [PLURAL[first] || first, ...rest].join(' ');
}

function spNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { date: `${parts.day}/${parts.month}/${parts.year}`, hour: Number(parts.hour) };
}

function prettyRestaurant(name) {
  const campus = { SC: 'São Carlos', RP: 'Ribeirão Preto' };
  let out = name.toLowerCase().replace(/(^|[\s(.-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  out = out.replace(/\b(De|Da|Do|Das|Dos|E)\b/g, (w) => w.toLowerCase());
  out = out.replace(/\s*\((Sc|Rp)\)/, (_, c) => ` · ${campus[c.toUpperCase()]}`);
  return out.replace(/^Eel/, 'EEL').replace(/^Each$/, 'EACH').replace(/^Pusp-Cb$/, 'PUSP-CB');
}

const dayInfo = (dateStr) => {
  const [d, m, y] = dateStr.split('/').map(Number);
  const date = new Date(y, m - 1, d);
  return { day: d, week: date.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '') };
};

// ---------------------------------------------------------------- dados
async function getJson(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

let menuReq = 0;
async function loadMenu() {
  const seq = ++menuReq;          // ignora respostas de um restaurante já trocado
  const id = state.restaurant.id;
  state.error = null;
  state.menu = null;
  state.manual = false;
  render();
  // se a TACO não carregou antes (ex.: "tentar de novo"), tenta de novo agora
  if (!state.db) {
    try { const taco = await getJson('/taco.json'); state.taco = taco; state.db = createDb(taco); } catch { /* segue; menu ainda aparece */ }
  }
  let menu = null, error = null;
  try { menu = await getJson(`/api/menu?id=${encodeURIComponent(id)}`); } catch (err) { error = err.message; }
  if (seq !== menuReq || id !== state.restaurant.id) return; // chegou tarde: outro restaurante foi escolhido
  state.menu = menu;
  state.error = error;
  if (menu) pickDefaultDay();
  buildMeal();
  render();
}

function pickDefaultDay() {
  const { date, hour } = spNow();
  const days = state.menu.days;
  const isOpen = (m) => m && !parseMenu(m.menu).closed;
  let idx = days.findIndex((d) => d.date === date);
  if (idx < 0 || (!isOpen(days[idx].lunch) && !isOpen(days[idx].dinner))) {
    const next = days.findIndex((d, i) => i > Math.max(idx, -1) && (isOpen(d.lunch) || isOpen(d.dinner)));
    idx = next >= 0 ? next : Math.max(0, idx);
  }
  state.dayIdx = idx;
  const day = days[idx];
  const isToday = day?.date === date;
  let meal = isToday && hour >= 15 ? 'dinner' : 'lunch';
  if (day && !isOpen(day[meal])) meal = meal === 'lunch' ? 'dinner' : 'lunch';
  if (day && !isOpen(day[meal])) meal = 'lunch';
  state.meal = meal;
}

function currentMeal() {
  return state.menu?.days[state.dayIdx]?.[state.meal] ?? null;
}

function buildMeal() {
  const meal = currentMeal();
  state.parsed = meal ? parseMenu(meal.menu) : null;
  state.expanded.clear();
  state.selected = {};
  if (!state.parsed || state.parsed.closed) return;
  const groups = choiceGroups(state.parsed.items);
  const byId = Object.fromEntries(state.parsed.items.map((it) => [it.id, it]));
  for (const [group, ids] of Object.entries(groups)) {
    const pref = state.choicePrefs[group];
    const items = ids.map((id) => byId[id]);
    let pick = items[0];
    if (group === 'prato' && pref) pick = items.find((it) => it.role === pref) || pick;
    if (group === 'arroz' && pref) pick = items.find((it) => it.key === pref) || pick;
    if (group === 'sobremesa' && pref) pick = items.find((it) => DISHES[it.key].kind === pref) || pick;
    state.selected[group] = pick.id;
  }
}

// ---------------------------------------------------------------- porções e cálculo
const groupOf = (it) => (it.key === 'arroz' || it.key === 'arroz_integral') && state.selected.arroz ? 'arroz' : it.group;

function isActive(it) {
  const g = groupOf(it);
  return state.selected[g] ? state.selected[g] === it.id : true;
}

function itemBase(it) {
  const override = state.overrides[norm(it.text)];
  if (override != null && state.db.byId.has(override)) return override;
  // suco/refresco: com ou sem açúcar (preferência da pessoa, vale para todas as refeições)
  if (it.key === 'refresco' && state.sugarFree) return 'refresco_zero';
  return it.key;
}

// pão só entra por padrão quando a refeição tem hambúrguer
const isBread = (it) => DISHES[it.key].kind === 'pao';
const hasBurger = () => (state.parsed?.items ?? []).some((x) => /hamb[uú]rg/i.test(x.text));

// chave da porção salva: não muda ao trocar com/sem açúcar (a quantidade de copos continua a mesma)
// inclui o texto do item: dois itens com o mesmo prato-base (ex.: dois purês) não compartilham porção
function prefKey(it) {
  const override = state.overrides[norm(it.text)];
  const base = override != null && state.db?.byId.has(override) ? `t${override}` : it.key;
  return `${base}|${norm(it.text)}`;
}

// porções alteradas valem só para a refeição em que foram feitas (restaurante + dia + almoço/jantar);
// toda outra refeição começa do padrão
function mealKey() {
  const day = state.menu?.days[state.dayIdx];
  return day ? `${state.restaurant.id}|${day.date}|${state.meal}` : '';
}
const mealPortions = () => state.portions[mealKey()] ?? {};

function portion(it) {
  const dish = DISHES[it.key];
  const saved = mealPortions()[prefKey(it)];
  const u = saved && saved.u < dish.units.length ? saved.u : 0;
  const fallback = isBread(it) && hasBurger() ? 1 : dish.qty;
  const q = Math.min(saved ? saved.q : fallback, dish.max ?? Infinity);
  return { u, q, unit: dish.units[u], grams: q * dish.units[u][1] };
}

function savePortions() {
  // guarda só as refeições mais recentes
  const keys = Object.keys(state.portions);
  for (const k of keys.slice(0, Math.max(0, keys.length - 30))) delete state.portions[k];
  store.set('portions-v3', state.portions);
}

// concha extra de molho (só pratos com molho): também vale só para a refeição atual
const SAUCE_CONCHA_G = 60;
const sauceCount = (it) => (it.sauce ? Number(mealPortions()[`molho:${prefKey(it)}`] || 0) : 0);

function sauceNutrients(it) {
  const n = sauceCount(it);
  const ing = n && state.db.ingredient(`x:molho-${it.sauce}`);
  if (!ing) return { kcal: 0, p: 0, c: 0, g: 0, f: 0 };
  const r = (n * SAUCE_CONCHA_G) / 100;
  return { kcal: ing.k * r, p: ing.p * r, c: ing.c * r, g: ing.g * r, f: ing.f * r };
}

function setSauce(it, delta) {
  const key = mealKey();
  const next = Math.max(0, Math.min(3, sauceCount(it) + delta));
  state.portions[key] = { ...mealPortions(), [`molho:${prefKey(it)}`]: next };
  savePortions();
  render();
}

function itemNutrients(it) {
  const p = portion(it);
  const n = state.db.nutrients({ base: itemBase(it), grams: p.grams, oleo: DISHES[it.key].oleo }, state.adjust ? AJUSTE_BANDEJAO : 0);
  const s = sauceNutrients(it);
  for (const k of ['kcal', 'p', 'c', 'g', 'f']) n[k] += s[k];
  return n;
}

function totals() {
  const t = { kcal: 0, p: 0, c: 0, g: 0, f: 0 };
  for (const it of state.parsed?.items ?? []) {
    if (!isActive(it)) continue;
    const n = itemNutrients(it);
    for (const k of Object.keys(t)) t[k] += n[k];
  }
  return t;
}

function setPortion(it, patch) {
  const cur = portion(it);
  const next = { u: cur.u, q: cur.q, ...patch };
  const key = mealKey();
  state.portions[key] = { ...mealPortions(), [prefKey(it)]: next };
  savePortions();
  render();
  const dish = DISHES[it.key];
  track.portion(it.key, next.q * dish.units[next.u][1], dish.qty * dish.units[0][1]);
}

// ---------------------------------------------------------------- render
function render() {
  renderDays();
  renderMealToggle();
  $('#restaurantName').textContent = state.restaurant.name;
  if (state.menu?.observation) $('#obs').textContent = `SAS/PRIP – USP · ${state.menu.observation}`;

  const summary = $('#summary');
  const sections = $('#sections');

  const bottom = $('#bottom');
  if (state.error) {
    summary.hidden = true;
    bottom.hidden = true;
    sections.innerHTML = `<div class="empty"><b>Não deu para carregar o cardápio</b>${esc(state.error)}<br><br><button class="link" id="retry">Tentar de novo</button></div>`;
    $('#retry').onclick = loadMenu;
    return updateSticky(null);
  }
  if (!state.menu || !state.db) {
    summary.hidden = false;
    bottom.hidden = true;
    summary.innerHTML = '<div class="skeleton"></div>';
    sections.innerHTML = '';
    return updateSticky(null);
  }
  if (!state.parsed || state.parsed.closed) {
    summary.hidden = true;
    bottom.hidden = true;
    const label = state.meal === 'lunch' ? 'almoço' : 'jantar';
    sections.innerHTML = `<div class="empty"><b>Sem ${label} neste dia</b>O restaurante está fechado ou o cardápio ainda não saiu.</div>`;
    return updateSticky(null);
  }

  summary.hidden = false;
  bottom.hidden = false;
  const t = totals();
  renderSummary(summary, t);
  renderSections(sections);
  renderRatings();
  updateSticky(t);
}

// ---------------------------------------------------------------- avaliação em estrelas
// Três notas por refeição: proteína, guarnição e sobremesa. A nota vale para o PRATO
// (não o dia), então o mesmo prato reaparece já avaliado; dá para mudar tocando de novo.
const RATING_CATS = [
  { cat: 'proteina', title: 'Prato principal', group: 'prato' },
  { cat: 'guarnicao', title: 'Guarnição', group: 'guarnicao' },
  { cat: 'sobremesa', title: 'Sobremesa', group: 'sobremesa' },
];

function ratingTarget(group) {
  const items = (state.parsed?.items ?? []).filter((it) => it.group === group);
  if (!items.length) return null;
  const selId = state.selected[group];
  return items.find((it) => it.id === selId) || items[0];
}

let ratingsKey = '';
function renderRatings() {
  const root = $('#ratings');
  const rows = RATING_CATS.map((c) => ({ ...c, item: ratingTarget(c.group) })).filter((r) => r.item);
  const key = rows.map((r) => `${r.cat}:${norm(r.item.text)}`).join('|');
  if (key === ratingsKey) return;
  ratingsKey = key;
  root.innerHTML = rows.map((r) => {
    const rkey = norm(r.item.text);
    const mine = state.ratings[rkey] || 0;
    const stars = [1, 2, 3, 4, 5].map((s) =>
      `<button class="star${s <= mine ? ' on' : ''}" data-key="${esc(rkey)}" data-cat="${r.cat}" data-label="${esc(r.item.text)}" data-star="${s}" aria-label="${s} estrela${s > 1 ? 's' : ''}">★</button>`).join('');
    return `<div class="rate-row">
      <div class="rate-info"><span class="rate-cat">${r.title}</span><span class="rate-dish">${esc(r.item.text)}</span></div>
      <div class="stars" role="group" aria-label="Avaliar ${esc(r.item.text)}">${stars}</div>
    </div>`;
  }).join('');
}

function rate(key, cat, label, stars) {
  const prev = state.ratings[key] || 0;
  if (prev === stars) stars = 0; // tocar na mesma estrela remove a nota? não: mantém. (0 = não enviar)
  if (!stars) return;
  state.ratings[key] = stars;
  store.set('ratings', state.ratings);
  ratingsKey = ''; // força redesenhar as estrelas
  renderRatings();
  beaconRate({ key, cat, label, stars, prev });
}

function beaconRate(payload) {
  try {
    fetch('/api/rate', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  } catch { /* sem conexão: a nota fica salva no navegador mesmo assim */ }
}

let daysKey = '';
function renderDays() {
  const nav = $('#days');
  if (!state.menu) { nav.innerHTML = ''; daysKey = ''; return; }
  const today = spNow().date;
  const key = `${state.menu.restaurantId}|${state.dayIdx}|${today}`;
  if (key === daysKey) return; // nada mudou: não mexe no DOM nem na rolagem
  daysKey = key;
  nav.innerHTML = state.menu.days.map((d, i) => {
    const { day, week } = dayInfo(d.date);
    const open = !parseMenu(d.lunch.menu).closed || !parseMenu(d.dinner.menu).closed;
    return `<button class="day${open ? '' : ' closed'}" data-day="${i}" aria-pressed="${i === state.dayIdx}">
      <small>${d.date === today ? 'hoje' : week}</small><b>${day}</b>${open ? '<span class="dot"></span>' : ''}</button>`;
  }).join('');
  // centraliza o dia escolhido só na horizontal (scrollIntoView rolaria a página inteira)
  const sel = nav.querySelector('[aria-pressed="true"]');
  if (sel) nav.scrollLeft = sel.offsetLeft - (nav.clientWidth - sel.offsetWidth) / 2;
}

function renderMealToggle() {
  for (const btn of document.querySelectorAll('.meal-toggle button')) {
    btn.setAttribute('aria-selected', String(btn.dataset.meal === state.meal));
  }
}

function macroPct(t) {
  const kp = t.p * 4, kc = t.c * 4, kg = t.g * 9, sum = kp + kc + kg || 1;
  return { p: kp / sum, c: kc / sum, g: kg / sum };
}

function renderSummary(el, t) {
  const pct = macroPct(t);
  const meal = currentMeal();
  const sas = meal?.kcal ?? state.parsed.kcal;
  const macro = (cls, label, val, p, color) => `
    <div class="macro" style="--c:var(${color})">
      <span class="lbl">${label}</span>
      <span class="val">${fmt(val)}<small> g</small></span>
      <span class="pct">${fmt(p * 100)}% das kcal</span>
    </div>`;
  el.innerHTML = `
    <div class="kcal-row">
      <div class="kcal">${fmt(t.kcal)}<small>kcal</small></div>
      ${sas ? `<div class="sas">SAS · refeição completa<br><b>${fmt(sas)} kcal</b></div>` : ''}
    </div>
    <div class="bar" aria-hidden="true">
      <i style="flex-grow:${pct.p};background:var(--prot)"></i>
      <i style="flex-grow:${pct.c};background:var(--carb)"></i>
      <i style="flex-grow:${pct.g};background:var(--fat)"></i>
    </div>
    <div class="macros">
      ${macro('p', 'Proteína', t.p, pct.p, '--prot')}
      ${macro('c', 'Carboidrato', t.c, pct.c, '--carb')}
      ${macro('g', 'Gordura', t.g, pct.g, '--fat')}
    </div>
    <label class="adjust">
      <span>Gordura extra do preparo do bandejão (+10% nas preparações)</span>
      <span class="switch"><input type="checkbox" id="adjust" ${state.adjust ? 'checked' : ''}><span></span></span>
    </label>`;
  $('#adjust').onchange = (e) => { state.adjust = e.target.checked; store.set('adjust', state.adjust); render(); };
}

function renderSections(root) {
  const items = state.parsed.items;
  const bySection = {};
  for (const it of items) (bySection[it.group] ||= []).push(it);

  root.innerHTML = SECTION_ORDER.filter((s) => bySection[s]).map((s) => {
    const list = bySection[s];
    const choiceGroup = s === 'base' ? 'arroz' : s;
    const choiceIds = choiceGroups(items)[choiceGroup];
    const chips = choiceIds ? `<div class="choices">${choiceIds.map((id) => {
      const it = items.find((x) => x.id === id);
      const veg = it.role === 'vegetariano' ? '<span class="leaf">● </span>' : '';
      return `<button class="choice" data-choice="${choiceGroup}" data-id="${id}" aria-pressed="${state.selected[choiceGroup] === id}">${veg}${esc(it.text)}</button>`;
    }).join('')}</div>` : '';
    const visible = list.filter((it) => isActive(it));
    return `<section class="section">
      <h2>${ROLE_TITLE[s]}</h2>${chips}
      <div class="items">${visible.map(renderItem).join('')}</div>
    </section>`;
  }).join('');

  root.querySelectorAll('[data-choice]').forEach((b) => (b.onclick = () => choose(b.dataset.choice, b.dataset.id)));
  root.querySelectorAll('.item').forEach(bindItem);
}

function renderItem(it) {
  const dish = DISHES[it.key];
  const p = portion(it);
  const n = itemNutrients(it);
  const base = itemBase(it);
  const overridden = typeof base === 'number';
  const liquid = p.unit[0] === 'ml' || p.unit[0].startsWith('copo') || p.unit[0].startsWith('xícara');
  const amount = p.q > 0 ? ` · ${fmt(p.grams)} ${liquid ? 'ml' : 'g'}` : '';
  const label = DISHES[typeof base === 'string' ? base : it.key].label;
  const ref = overridden
    ? `TACO: ${state.db.byId.get(base).n}`
    : it.generic ? `estimativa genérica · ${label}` : `≈ ${label}`;
  // − / + andam de 1 em 1 (de 10 em 10 em gramas); frações a pessoa digita
  const step = p.unit[1] === 1 ? 10 : 1;
  const open = state.expanded.has(it.id);
  const per = state.db.per100(base);
  return `<div class="item${p.q === 0 ? ' off' : ''}" data-id="${it.id}" data-step="${step}">
    <div class="item-top">
      <button class="name-btn" data-act="toggle" aria-expanded="${open}">
        <span class="name">${esc(it.text)}</span>
        <span class="ref${it.generic && !overridden ? ' generic' : ''}">${esc(ref + amount)}</span>
      </button>
      <span class="kc">${fmt(n.kcal)} <small>kcal</small></span>
    </div>
    <div class="portion">
      <button class="step" data-act="minus" aria-label="Diminuir">−</button>
      <input class="qty" data-act="qty" inputmode="decimal" enterkeyhint="done" value="${fmtQty(p.q)}" aria-label="Quantidade">
      <button class="step" data-act="plus" aria-label="Aumentar" ${dish.max != null && p.q >= dish.max ? 'disabled' : ''}>+</button>
      ${dish.units.length > 1 ? `<select class="unit" data-act="unit" aria-label="Medida">
        ${dish.units.map(([name], i) => `<option value="${i}" ${i === p.u ? 'selected' : ''}>${esc(unitLabel(name, p.q))}</option>`).join('')}
      </select>` : `<span class="unit static">${esc(unitLabel(p.unit[0], p.q))}</span>`}
      <span class="macro-mini" aria-label="Macros da porção">
        <span>P ${fmt(n.p, 1)} g</span><span>C ${fmt(n.c, 1)} g</span>
        <span>G ${fmt(n.g, 1)} g</span><span>Fibra ${fmt(n.f, 1)} g</span>
      </span>
    </div>
    ${it.key === 'refresco' && !overridden ? `<div class="sugar" role="group" aria-label="Açúcar no suco">
      <button data-act="sugar-off" aria-pressed="${!state.sugarFree}">com açúcar</button>
      <button data-act="sugar-on" aria-pressed="${state.sugarFree}">sem açúcar</button>
    </div>` : ''}
    ${it.sauce ? (() => {
      const sc = sauceCount(it);
      const sk = sauceNutrients(it).kcal;
      return sc
        ? `<div class="sauce on"><span>+ ${sc} concha${sc > 1 ? 's' : ''} de molho <small>(+${fmt(sk)} kcal)</small></span>
            <span class="sauce-btns"><button data-act="sauce-minus" aria-label="Menos molho">−</button><button data-act="sauce-plus" aria-label="Mais molho" ${sc >= 3 ? 'disabled' : ''}>+</button></span></div>`
        : `<button class="sauce" data-act="sauce-plus">＋ pedir uma concha a mais de molho</button>`;
    })() : ''}
    ${open ? `<div class="detail">
      ${n.extra ? `<span>Inclui +${fmt(n.extra)} kcal de gordura do preparo.</span>` : ''}
      <span>Por 100 g: ${fmt(per.k)} kcal · composição usada:</span>
      <ul>${per.sources.map((s) => `<li>${s.pct}% ${esc(s.n)}${s.taco ? '' : ' (estimativa)'}</li>`).join('')}</ul>
      <button class="link" data-act="swap">Trocar por outro alimento da TACO</button>
    </div>` : ''}
  </div>`;
}

function bindItem(el) {
  const it = state.parsed.items.find((x) => x.id === el.dataset.id);
  const step = Number(el.dataset.step);
  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'toggle') {
      state.expanded.has(it.id) ? state.expanded.delete(it.id) : state.expanded.add(it.id);
      render();
    } else if (act === 'minus') {
      setPortion(it, { q: Math.max(0, +(portion(it).q - step).toFixed(2)) });
    } else if (act === 'plus') {
      setPortion(it, { q: Math.min(+(portion(it).q + step).toFixed(2), DISHES[it.key].max ?? Infinity) });
    } else if (act === 'swap') {
      openFoodSheet(it);
    } else if (act === 'sauce-plus') {
      setSauce(it, +1);
    } else if (act === 'sauce-minus') {
      setSauce(it, -1);
    } else if (act === 'sugar-on' || act === 'sugar-off') {
      state.sugarFree = act === 'sugar-on';
      store.set('sugarFree', state.sugarFree);
      track.choice('suco', state.sugarFree ? 'sem-acucar' : 'com-acucar');
      render();
    }
  });
  const qtyInput = el.querySelector('[data-act="qty"]');
  qtyInput.addEventListener('focus', () => qtyInput.select());
  qtyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') qtyInput.blur(); });
  qtyInput.addEventListener('change', () => {
    const typed = Number(qtyInput.value.replace(',', '.').trim());
    if (!Number.isFinite(typed) || typed < 0) { render(); return; }
    setPortion(it, { q: Math.min(+typed.toFixed(2), DISHES[it.key].max ?? Infinity) });
  });
  el.querySelector('[data-act="unit"]')?.addEventListener('change', (e) => {
    const dish = DISHES[it.key];
    const cur = portion(it);
    const u = Number(e.target.value);
    // mantém aproximadamente os mesmos gramas ao trocar de medida
    const unitG = dish.units[u][1];
    const raw = cur.grams / unitG;
    const q = unitG === 1 ? Math.round(raw / 10) * 10 : Math.max(1, Math.round(raw));
    setPortion(it, { u, q });
  });
}

function choose(group, id) {
  state.selected[group] = id;
  const it = state.parsed.items.find((x) => x.id === id);
  state.choicePrefs[group] = group === 'prato' ? it.role : group === 'arroz' ? it.key : DISHES[it.key].kind;
  store.set('choices', state.choicePrefs);
  track.choice(group, it.key);
  render();
}

// barra fixa com o total quando o resumo sai da tela
let summaryVisible = true;
function updateSticky(t) {
  const el = $('#stickyTotal');
  if (!t) { el.classList.remove('show'); el.innerHTML = ''; return; }
  el.innerHTML = `<b>${fmt(t.kcal)} kcal</b><span class="m">
    <span style="--c:var(--prot)">${fmt(t.p)}g</span><span style="--c:var(--carb)">${fmt(t.c)}g</span><span style="--c:var(--fat)">${fmt(t.g)}g</span></span>`;
  el.classList.toggle('show', !summaryVisible);
}
new IntersectionObserver(([entry]) => {
  summaryVisible = entry.isIntersecting;
  $('#stickyTotal').classList.toggle('show', !summaryVisible && $('#stickyTotal').innerHTML !== '');
}).observe($('#summary'));

// ---------------------------------------------------------------- gavetas
function bindSheet(dialog) {
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target.closest('[data-close]')) dialog.close();
  });
}

async function openRestaurantSheet() {
  const dialog = $('#restaurantSheet');
  const list = $('#restaurantList');
  dialog.showModal();
  if (!state.restaurants) {
    list.innerHTML = '<div class="skeleton" style="height:240px"></div>';
    try { state.restaurants = await getJson('/api/restaurants'); } catch (err) {
      list.innerHTML = `<p>Não deu para carregar a lista (${esc(err.message)}).</p>`;
      return;
    }
  }
  list.innerHTML = state.restaurants.map((c) => `
    <div class="campus">${esc(c.campus)}</div>
    ${c.restaurants.map((r) => {
      const hours = r.hours?.weekdays?.lunch ? `almoço ${r.hours.weekdays.lunch}` : '';
      return `<button class="rest" data-id="${esc(r.id)}" data-name="${esc(prettyRestaurant(r.name))}" aria-pressed="${r.id === state.restaurant.id}">
        <span>${esc(prettyRestaurant(r.name))}<small>${esc(hours)}</small></span></button>`;
    }).join('')}`).join('');
  list.querySelectorAll('.rest').forEach((b) => (b.onclick = () => {
    state.restaurant = { id: b.dataset.id, name: b.dataset.name };
    store.set('restaurant', state.restaurant);
    dialog.close();
    loadMenu();
  }));
}

let foodItem = null;
function openFoodSheet(it) {
  foodItem = it;
  $('#foodSheetTitle').textContent = it.text;
  const input = $('#foodSearch');
  input.value = '';
  renderFoodResults('');
  $('#foodSheet').showModal();
  input.focus();
}

function renderFoodResults(q) {
  const terms = norm(q).split(' ').filter(Boolean);
  const list = terms.length
    ? state.taco.filter((f) => { const n = norm(f.n); return terms.every((t) => n.includes(t)); }).slice(0, 60)
    : [];
  $('#foodResults').innerHTML = list.map((f) => `<li><button data-id="${f.id}"><span>${esc(f.n)}</span><small>${fmt(f.k)} kcal/100 g</small></button></li>`).join('')
    || `<li style="color:var(--muted);padding:8px 4px">${terms.length ? 'Nada encontrado.' : 'Digite para buscar entre os 591 alimentos da TACO.'}</li>`;
}

$('#foodSearch').addEventListener('input', (e) => renderFoodResults(e.target.value));
$('#foodResults').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-id]');
  if (!b || !foodItem) return;
  state.overrides[norm(foodItem.text)] = Number(b.dataset.id);
  store.set('overrides', state.overrides);
  track.swap(foodItem.key, Number(b.dataset.id));
  $('#foodSheet').close();
  render();
});
$('#foodReset').onclick = () => {
  if (foodItem) delete state.overrides[norm(foodItem.text)];
  store.set('overrides', state.overrides);
  $('#foodSheet').close();
  render();
};

// ---------------------------------------------------------------- eventos gerais
$('#days').addEventListener('click', (e) => {
  const b = e.target.closest('[data-day]');
  if (!b) return;
  state.manual = true;
  state.dayIdx = Number(b.dataset.day);
  buildMeal();
  render();
  track.meal();
});
document.querySelectorAll('.meal-toggle button').forEach((b) => (b.onclick = () => {
  state.manual = true;
  state.meal = b.dataset.meal;
  buildMeal();
  render();
  track.meal();
}));

// página deixada aberta: ao voltar para a aba, reposiciona em hoje/refeição do horário
// (almoço até 15h, jantar depois), a menos que a pessoa tenha escolhido dia/refeição na mão
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || state.manual || !state.menu) return;
  const before = `${state.dayIdx}|${state.meal}`;
  pickDefaultDay();
  if (`${state.dayIdx}|${state.meal}` !== before) { buildMeal(); render(); }
});
$('#restaurantBtn').onclick = openRestaurantSheet;
$('#resetBtn').onclick = () => {
  state.portions = {};
  state.overrides = {};
  store.set('portions-v3', {});
  store.set('overrides', {});
  render();
};
bindSheet($('#restaurantSheet'));
bindSheet($('#foodSheet'));
$('#ratings').addEventListener('click', (e) => {
  const b = e.target.closest('.star');
  if (b) rate(b.dataset.key, b.dataset.cat, b.dataset.label, Number(b.dataset.star));
});

// ---------------------------------------------------------------- início
(async function init() {
  render();
  const tacoPromise = getJson('/taco.json').then((taco) => {
    state.taco = taco;
    state.db = createDb(taco);
  });
  await Promise.all([tacoPromise.catch((err) => { state.error = `tabela TACO: ${err.message}`; }), loadMenu()]);
  render();
  track.view();
})();
