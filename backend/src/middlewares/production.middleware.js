import jwt from 'jsonwebtoken';
import { ENV } from '../libs/env.js';
import protect from './auth.middleware.js';
import ProductionStaff from '../models/ProductionStaff.js';
import { isProductionAdmin } from '../libs/productionAccess.js';
export function requireProductionAdmin(req, res, next) {
  if (!isProductionAdmin(req.user)) return res.status(403).json({ message: 'Bu işlem yalnız mağaza yöneticisine açıktır.' });
  next();
}
export async function productionAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  let decoded;
  try { decoded = jwt.verify(token, ENV.JWT_SECRET); }
  catch { return res.status(401).json({ message: 'Oturum geçersiz. Yeniden giriş yapın.' }); }
  if (decoded.scope === 'production') {
    if (decoded.aud !== 'sahinsoy-production' || !/^[a-f\d]{24}$/i.test(decoded.id || '')) return res.status(401).json({ message: 'Üretim oturumu geçersiz.' });
    try {
      const staff = await ProductionStaff.findById(decoded.id).lean();
      if (!staff?.active || staff.session_version !== decoded.version) return res.status(401).json({ message: 'Giriş izniniz kapalı veya değiştirildi. Yöneticinizle görüşün.' });
      req.productionActor = { kind: 'staff', _id: String(staff._id), name: staff.name, duties: staff.duties };
      return next();
    } catch { return res.status(500).json({ message: 'Oturum kontrol edilemedi.' }); }
  }
  return protect(req, res, () => requireProductionAdmin(req, res, () => {
    req.productionActor = { kind: 'admin', _id: String(req.user._id), name: req.user.user_username, duties: [] };
    next();
  }));
}
export function productionAdminOnly(req, res, next) {
  if (req.productionActor.kind !== 'admin') return res.status(403).json({ message: 'Bu işlem yalnız mağaza yöneticisine açıktır.' });
  next();
}
