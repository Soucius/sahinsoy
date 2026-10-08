import mongoose from "mongoose";
import Product from "../models/Product.js";
import Role from "../models/Role.js";

const INVALID_VARIANTS = "INVALID_VARIANTS";
const unsafeText = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;

function hasOnlyKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).every((key) => keys.includes(key));
}

// Compare codes without changing their displayed spelling or punctuation.
export function variantCodeKey(value) {
  return String(value ?? "").normalize("NFC").trim().replace(/\s+/gu, " ")
    .replace(/[Iİı]/gu, "i").toLocaleLowerCase("tr-TR");
}

export function normalizeVariantEnrichment(body) {
  if (!hasOnlyKeys(body, ["kind", "products"]) || body.kind !== "variant-enrichment"
    || !Array.isArray(body.products) || body.products.length < 1 || body.products.length > 3000) {
    throw new Error(INVALID_VARIANTS);
  }
  const catalogIds = new Set();
  return body.products.map((product) => {
    if (!hasOnlyKeys(product, ["catalog_id", "variants"])
      || typeof product.catalog_id !== "string" || !/^URUN-\d{4,6}$/.test(product.catalog_id)
      || catalogIds.has(product.catalog_id) || !Array.isArray(product.variants)
      || product.variants.length < 1 || product.variants.length > 500) throw new Error(INVALID_VARIANTS);
    catalogIds.add(product.catalog_id);
    const codes = new Set();
    const variants = product.variants.map((variant) => {
      if (!hasOnlyKeys(variant, ["vr", "color"]) || typeof variant.vr !== "string"
        || typeof variant.color !== "string" || !variant.vr.trim()
        || variant.vr.length > 100 || variant.color.length > 100
        || unsafeText.test(variant.vr) || unsafeText.test(variant.color)
        || !variant.vr.isWellFormed() || !variant.color.isWellFormed()) throw new Error(INVALID_VARIANTS);
      const key = variantCodeKey(variant.vr);
      if (codes.has(key)) throw new Error(INVALID_VARIANTS);
      codes.add(key);
      return { vr: variant.vr.trim(), color: variant.color.trim() };
    });
    return { catalog_id: product.catalog_id, variants };
  });
}

function batchError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

export async function appendCatalogVariants(req, res) {
  try {
    if (mongoose.connection.name !== "sahinsoy_test") {
      return res.status(403).json({ message: "Renk / VR aktarımı yalnız test ortamında açık." });
    }
    const role = await Role.findById(req.user?.user_role);
    if (role?.role_name !== "Test Yöneticisi") {
      return res.status(403).json({ message: "Renk / VR aktarımı için test yöneticisi yetkisi gerekiyor." });
    }
    let records;
    try { records = normalizeVariantEnrichment(req.body); }
    catch {
      return res.status(400).json({ message: "Geçersiz veya tekrarlanan renk / VR kaydı var. Stok ve fiyat alanları bu aktarımda kabul edilmez; hiçbir ürün değiştirilmedi." });
    }
    const session = await mongoose.startSession();
    let result;
    try {
      await session.withTransaction(async () => {
        // This callback can be retried. Re-read the current variants and reset counts each time.
        const products = await Product.find({ catalog_id: { $in: records.map((record) => record.catalog_id) } })
          .select("_id catalog_id product_brand variants")
          .populate("product_brand", "brand_name").session(session).lean();
        const targets = new Map(products.map((product) => [product.catalog_id, product]));
        const plans = [];
        const attemptResult = { addedVariants: 0, existingVariants: 0, productsTouched: 0, productsTotal: records.length };
        for (const record of records) {
          const target = targets.get(record.catalog_id);
          if (!target || variantCodeKey(target.product_brand?.brand_name) !== variantCodeKey("OBA Perdesan")) {
            throw batchError("Katalogdaki bir ürün bulunamadı veya OBA Perdesan markasına ait değil; hiçbir ürün değiştirilmedi.");
          }
          if (target.variants != null && !Array.isArray(target.variants)) {
            throw batchError("Bir ürünün mevcut renk / VR kayıtları geçersiz; hiçbir ürün değiştirilmedi.");
          }
          const currentVariants = target.variants ?? [];
          const currentCodes = new Set(currentVariants.filter((variant) => typeof variant?.vr === "string" && variant.vr.trim())
            .map((variant) => variantCodeKey(variant.vr)));
          const additions = [];
          for (const variant of record.variants) {
            if (currentCodes.has(variantCodeKey(variant.vr))) attemptResult.existingVariants++;
            else additions.push({ ...variant, stock_quantity: 0 });
          }
          if (currentVariants.length + additions.length > 500) {
            throw batchError("Bir üründe 500 renk / VR sınırı aşılacak; hiçbir ürün değiştirilmedi.");
          }
          if (additions.length) {
            plans.push({ target, additions });
            attemptResult.addedVariants += additions.length;
            attemptResult.productsTouched++;
          }
        }
        // Validate every target and limit first; append only, never replace an existing array.
        for (const { target, additions } of plans) {
          const written = await Product.updateOne({ _id: target._id, catalog_id: target.catalog_id },
            { $push: { variants: { $each: additions } } }, { session, runValidators: true });
          if (written.matchedCount !== 1 || written.modifiedCount !== 1) {
            throw batchError("Bir ürün aktarım sırasında değişti; hiçbir ürün değiştirilmedi. Dosyayı tekrar aktarabilirsiniz.");
          }
        }
        result = attemptResult;
      });
    } finally { await session.endSession(); }
    return res.status(200).json({ ...result, message: `${result.addedVariants} renk / VR eklendi. ${result.existingVariants} mevcut kayıt, fiyatlar ve stoklar korundu.` });
  } catch (error) {
    if (error.statusCode === 400) return res.status(400).json({ message: error.message });
    console.error("Test renk / VR aktarımı başarısız.");
    return res.status(500).json({ message: "Renk / VR aktarımı tamamlanamadı. Mevcut ürünler korunur; aynı dosyayı tekrar aktarabilirsiniz." });
  }
}
