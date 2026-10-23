import { getRestaurantsCached } from '../lib/uspcache.js';

export default async function handler(req, res) {
  try {
    const { restaurants: list } = await getRestaurantsCached(); // a USP só é consultada uma vez por dia
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    res.status(200).json(list);
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
