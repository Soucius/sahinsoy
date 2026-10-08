import mongoose from "mongoose";
import Product from "../models/Product.js";
import Brand from "../models/Brand.js";
import Category from "../models/Category.js";
import Unit from "../models/Unit.js";
import Role from "../models/Role.js";

const currencies = ["TRY", "USD", "EUR"];
const numericFields = ["width_cm", "grammage_gr", "min_m2", "rounding_step", "min_width_cm", "min_height_cm", "dimension_rounding_cm"];

export function normalizeCatalog(products) {
  if (!Array.isArray(products) || products.length < 1 || products.length > 3000) throw new Error("INVALID_CATALOG");
  const ids = new Set();
  const nonnegative = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
  const text = (value) => typeof value === "string" && value.trim() && value.trim().length < 200;
  return products.map((product) => {
    if (!product || typeof product.catalog_id !== "string" || !/^URUN-\d{4,6}$/.test(product.catalog_id) || ids.has(product.catalog_id) || ![product.name, product.brand, product.category].every(text) || !["Metre", "Adet", "Metrekare"].includes(product.unit) || ![product.sale_price, product.purchase_price].every(nonnegative)) throw new Error("INVALID_CATALOG");
    const currency = product.currency ?? "TRY";
    if (!currencies.includes(currency)) throw new Error("INVALID_CATALOG");
    ids.add(product.catalog_id);
    const record = { catalog_id: product.catalog_id, name: product.name.trim(), brand: product.brand.trim(), category: product.category.trim(), unit: product.unit, sale_price: product.sale_price, purchase_price: product.purchase_price, currency };
    for (const field of numericFields) {
      const value = product[field] === undefined ? 0 : product[field];
      if (!nonnegative(value)) throw new Error("INVALID_CATALOG");
      record[field] = value;
    }
    if (record.unit !== "Metrekare" && (record.min_m2 || record.rounding_step || record.min_height_cm)) throw new Error("INVALID_CATALOG");
    if (record.unit === "Adet" && (record.min_width_cm || record.dimension_rounding_cm)) throw new Error("INVALID_CATALOG");
    const options = product.extra_options === undefined ? [] : product.extra_options;
    if (!Array.isArray(options) || options.length > 200) throw new Error("INVALID_CATALOG");
    const optionNames = new Set();
    record.extra_options = options.map((option) => {
      if (!option || !text(option.option_name) || !nonnegative(option.price_impact)) throw new Error("INVALID_CATALOG");
      const name = option.option_name.trim();
      const key = name.toLocaleLowerCase("tr-TR");
      const basis = option.pricing_basis ?? "birim";
      const scope = option.pricing_scope === undefined ? "parca" : option.pricing_scope;
      const optionCurrency = option.currency ?? currency;
      if (optionNames.has(key) || !["birim", "adet", "mt", "m2", "yuzde"].includes(basis) || !["parca", "kasa"].includes(scope) || !currencies.includes(optionCurrency) || (optionCurrency !== "TRY" && optionCurrency !== currency) || (basis === "yuzde" && (option.price_impact > 100 || optionCurrency !== "TRY"))) throw new Error("INVALID_CATALOG");
      optionNames.add(key);
      return { option_name: name, price_impact: option.price_impact, pricing_basis: basis, pricing_scope: scope, currency: optionCurrency };
    });
    return record;
  });
}

export async function importCatalog(req, res) {
  try {
    if (mongoose.connection.name !== "sahinsoy_test") return res.status(403).json({message:"Katalog aktarımı yalnız test ortamında açık."});
    const role = await Role.findById(req.user?.user_role);
    if (role?.role_name !== "Test Yöneticisi") return res.status(403).json({message:"Katalog aktarımı için yönetici yetkisi gerekiyor."});
    const input=req.body?.products;
    if(!Array.isArray(input)||input.length<1||input.length>3000) return res.status(400).json({message:"1–3000 ürün içeren katalog dosyası seçin."});
    let records;
    try { records=normalizeCatalog(input); }
    catch { return res.status(400).json({message:"Katalogda geçersiz ürün, hesaplama kuralı veya aksesuar var; aktarım yapılmadı."}); }
    const session=await mongoose.startSession();
    let result;
    try {
      await session.withTransaction(async()=>{
        const brandIds=new Map(),categoryIds=new Map(),unitIds=new Map();
        for(const name of new Set(records.map(p=>p.brand))){const x=await Brand.findOneAndUpdate({brand_name:name},{$setOnInsert:{brand_name:name}},{upsert:true,new:true,session});brandIds.set(name,x._id);}
        for(const name of new Set(records.map(p=>p.category))){const x=await Category.findOneAndUpdate({category_name:name},{$setOnInsert:{category_name:name}},{upsert:true,new:true,session});categoryIds.set(name,x._id);}
        for(const name of new Set(records.map(p=>p.unit))){const x=await Unit.findOneAndUpdate({unit_name:name},{$setOnInsert:{unit_name:name,unit_code:name==="Metre"?"m":name==="Metrekare"?"m²":"ad"}},{upsert:true,new:true,session});unitIds.set(name,x._id);}
        const written=await Product.bulkWrite(records.map(p=>({updateOne:{filter:{catalog_id:p.catalog_id},update:{$setOnInsert:{catalog_id:p.catalog_id,product_name:p.name,product_barcode:`CAT-${p.catalog_id}`,product_brand:brandIds.get(p.brand),product_category:categoryIds.get(p.category),product_unit:unitIds.get(p.unit),calculation_type:p.unit==="Adet"?"adet":p.unit==="Metrekare"?"m2":"mt",purchase_price:p.purchase_price,sale_price:p.sale_price,currency:p.currency,stock_tracking:false,stock_quantity:0,variants:[],product_color:"",fabric_width_cm:p.width_cm,grammage_gr:p.grammage_gr,min_m2:p.min_m2,rounding_step:p.rounding_step,min_width_cm:p.min_width_cm,min_height_cm:p.min_height_cm,dimension_rounding_cm:p.dimension_rounding_cm,extra_options:p.extra_options}},upsert:true}})),{session,ordered:true});
        result={added:written.upsertedCount,existing:records.length-written.upsertedCount,total:records.length};
      });
    } finally {await session.endSession();}
    res.status(200).json({...result,message:`${result.added} ürün eklendi. ${result.existing} mevcut ürün korundu.`});
  } catch {
    console.error("Test kataloğu aktarımı başarısız.");
    res.status(500).json({message:"Katalog aktarımı tamamlanamadı. Mevcut ürünler korunur; aynı dosyayı tekrar aktarabilirsiniz."});
  }
}
