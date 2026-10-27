import { haremGoldRateService } from '../libs/haremExchangeRates.js';

export async function getGoldRates(req, res) {
  res.set('Cache-Control', 'no-store');
  try { return res.json(await haremGoldRateService.getRates()); }
  catch { return res.status(503).json({ message: 'Güncel Harem altın satış kuru alınamadı. Altın miktarı kayıtlı kalır; TL karşılığı için yeniden deneyin.' }); }
}
