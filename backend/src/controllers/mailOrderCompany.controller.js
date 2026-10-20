import MailOrderCompany from "../models/MailOrderCompany.js";
import { companyLinkInput, CompanyLinkError } from "../libs/mailOrderCompanyLinks.js";
const publicLink = record => ({ company: record.company, url: record.url, revision: record.revision });
export async function getCompanyLinks(req, res) {
  try { res.json((await MailOrderCompany.find().sort({ company: 1 })).map(publicLink)); }
  catch { res.status(500).json({ message: "Firma bağlantıları yüklenemedi." }); }
}
export async function saveCompanyLink(req, res) {
  try {
    const value = companyLinkInput(req.body);
    const existing = await MailOrderCompany.findOne({ key: value.key });
    if (existing?.url === value.url) return res.json(publicLink(existing));
    if ((existing?.revision || 0) !== value.revision) throw new CompanyLinkError("Firma bağlantısı başka ekranda değişti. Yenileyip tekrar kontrol edin.", 409);
    let saved;
    if (!existing) {
      saved = await MailOrderCompany.create({ key: value.key, company: value.company, url: value.url, revision: 1, updated_by: req.user._id });
    } else {
      saved = await MailOrderCompany.findOneAndUpdate({ key: value.key, revision: value.revision }, { $set: { company: value.company, url: value.url, updated_by: req.user._id }, $inc: { revision: 1 } }, { new: true, runValidators: true });
      if (!saved) throw new CompanyLinkError("Firma bağlantısı başka ekranda değişti. Yenileyip tekrar kontrol edin.", 409);
    }
    res.json(publicLink(saved));
  } catch (error) {
    if (error instanceof CompanyLinkError) return res.status(error.status).json({ message: error.message });
    if (error.code === 11000) return res.status(409).json({ message: "Firma bağlantısı başka ekranda kaydedildi. Yenileyip kontrol edin." });
    res.status(500).json({ message: "Bağlantı kaydı doğrulanamadı. Yenileyip kontrol edin." });
  }
}
