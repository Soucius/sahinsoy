export class CompanyLinkError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function companyKey(company) {
  if (typeof company !== "string" || company.length > 120 || /[\u0000-\u001f]/u.test(company) || !company.trim()) throw new CompanyLinkError("Firma adını kontrol edin.");
  return company.trim().replace(/\s+/gu, " ").toLocaleLowerCase("tr-TR");
}
export function companyLinkInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !["company", "url", "expected_revision"].includes(key))) throw new CompanyLinkError("Bağlantı bilgilerini kontrol edin.");
  const key = companyKey(input.company);
  if (typeof input.url !== "string" || input.url.length > 2048 || /[\u0000-\u0020]/u.test(input.url.trim())) throw new CompanyLinkError("Geçerli bir HTTPS bağlantısı girin.");
  const raw = input.url.trim();
  let url = "";
  if (raw) {
    let parsed;
    try { parsed = new URL(raw); } catch { throw new CompanyLinkError("Bağlantı https:// ile başlamalıdır."); }
    if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) throw new CompanyLinkError("Kullanıcı adı veya parola içermeyen bir HTTPS bağlantısı girin.");
    url = parsed.href;
  }
  if (!Number.isSafeInteger(input.expected_revision) || input.expected_revision < 0) throw new CompanyLinkError("Bağlantı sürümü geçersiz; bilgileri yenileyin.");
  return { key, company: input.company.trim().replace(/\s+/gu, " "), url, revision: input.expected_revision };
}
