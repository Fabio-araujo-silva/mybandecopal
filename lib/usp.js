// Cliente da API do Cardápio USP (a mesma que o app oficial usa).
// As duas credenciais do app ficam em variáveis de ambiente (.env local / painel da Vercel),
// nunca no código — veja .env.example.

const BASE = 'https://uspdigital.usp.br/rucard/servicos';

function credentials() {
  const hash = process.env.USP_MENU_HASH;
  const devKey = process.env.USP_DEV_KEY;
  if (!hash || !devKey) throw new Error('faltam USP_MENU_HASH e USP_DEV_KEY no ambiente (veja .env.example)');
  return { hash, devKey };
}

async function post(path) {
  const { hash: HASH, devKey: DEV_KEY } = credentials();
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'DEV-USP-MOBILE': DEV_KEY,
    },
    body: `hash=${HASH}`,
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`USP respondeu HTTP ${res.status}`);
  return res.json();
}

export async function getRestaurants() {
  const campi = await post('restaurants');
  return campi.map((c) => ({
    campus: c.name,
    restaurants: c.restaurants.map((r) => ({
      id: r.id,
      name: r.alias || r.name,
      address: r.address,
      phones: r.phones,
      hours: r.workinghours,
      prices: r.cashiers?.[0]?.prices ?? null,
    })),
  }));
}

export async function getMenu(id) {
  if (!/^\d{1,3}$/.test(String(id))) throw new Error('id de restaurante inválido');
  const data = await post(`menu/${id}`);
  if (data?.message?.error) throw new Error(data.message.message || 'erro no cardápio');
  return {
    restaurantId: String(id),
    observation: data.observation?.observation ?? '',
    days: (data.meals ?? []).map((m) => ({
      date: m.date,
      lunch: meal(m.lunch),
      dinner: meal(m.dinner),
    })),
  };
}

function meal(m) {
  const menu = (m?.menu ?? '').trim();
  const kcal = Number(m?.calories);
  return { menu, kcal: Number.isFinite(kcal) && kcal > 0 ? kcal : null };
}
