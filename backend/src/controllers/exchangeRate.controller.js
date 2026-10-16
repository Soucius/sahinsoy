import { exchangeRateService } from "../libs/exchangeRates.js";
import { haremExchangeRateService } from "../libs/haremExchangeRates.js";

export async function getExchangeRates(req, res) {
  // Currency data is public, but the POS endpoint requires a live user session.
  if (!req.user) return res.status(401).json({ message: "Oturumunuz bulunamadı. Lütfen yeniden giriş yapın." });
  res.set("Cache-Control", "no-store");
  const provider = req.query?.provider ?? "tcmb";
  if (!["tcmb", "harem"].includes(provider)) return res.status(400).json({
    code: "INVALID_EXCHANGE_RATE_PROVIDER",
    message: "Desteklenmeyen kur kaynağı. TCMB veya Harem seçin.",
  });
  try {
    return res.status(200).json(await (provider === "harem" ? haremExchangeRateService : exchangeRateService).getRates());
  } catch {
    return res.status(503).json({
      code: "EXCHANGE_RATES_UNAVAILABLE",
      message: provider === "harem"
        ? "Harem alış kuru şu anda alınamadı veya güncel değil. Kuru elle girebilir veya yeniden deneyebilirsiniz."
        : "TCMB kuru şu anda alınamadı. Kuru elle girebilir veya yeniden deneyebilirsiniz.",
    });
  }
}
