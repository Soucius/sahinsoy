import mongoose from "mongoose";
import Product from "../models/Product.js";
import Brand from "../models/Brand.js";
import Category from "../models/Category.js";
import Unit from "../models/Unit.js";
import Role from "../models/Role.js";

export async function importCatalog(req, res) {
  try {
    if (mongoose.connection.name !== "sahinsoy_test") return res.status(403).json({message:"Katalog aktarımı yalnız test ortamında açık."});
    const role = await Role.findById(req.user?.user_role);
    if (role?.role_name !== "Test Yöneticisi") return res.status(403).json({message:"Katalog aktarımı için yönetici yetkisi gerekiyor."});
    const records=req.body.products;
    if(!Array.isArray(records)||records.length<1||records.length>3000) return res.status(400).json({message:"1–3000 ürün içeren katalog dosyası seçin."});
    const ids=new Set();
    for(const p of records){
      if(!p||typeof p.catalog_id!=="string"||!/^URUN-\d{4,6}$/.test(p.catalog_id)||ids.has(p.catalog_id)||![p.name,p.brand,p.category].every(x=>typeof x==="string"&&x.trim()&&x.length<200)||!["Metre","Adet","Metrekare"].includes(p.unit)||![p.sale_price,p.purchase_price].every(x=>Number.isFinite(x)&&x>=0)||!["TRY","USD","EUR"].includes(p.currency||"TRY")) return res.status(400).json({message:"Katalogda geçersiz veya yinelenen ürün var; aktarım yapılmadı."});
      ids.add(p.catalog_id);
    }
    const session=await mongoose.startSession();
    let result;
    try {
      await session.withTransaction(async()=>{
        const brandIds=new Map(),categoryIds=new Map(),unitIds=new Map();
        for(const name of new Set(records.map(p=>p.brand))){const x=await Brand.findOneAndUpdate({brand_name:name},{$setOnInsert:{brand_name:name}},{upsert:true,new:true,session});brandIds.set(name,x._id);}
        for(const name of new Set(records.map(p=>p.category))){const x=await Category.findOneAndUpdate({category_name:name},{$setOnInsert:{category_name:name}},{upsert:true,new:true,session});categoryIds.set(name,x._id);}
        for(const name of new Set(records.map(p=>p.unit))){const x=await Unit.findOneAndUpdate({unit_name:name},{$setOnInsert:{unit_name:name,unit_code:name==="Metre"?"m":name==="Metrekare"?"m²":"ad"}},{upsert:true,new:true,session});unitIds.set(name,x._id);}
        const written=await Product.bulkWrite(records.map(p=>({updateOne:{filter:{catalog_id:p.catalog_id},update:{$setOnInsert:{catalog_id:p.catalog_id,product_name:p.name,product_barcode:`CAT-${p.catalog_id}`,product_brand:brandIds.get(p.brand),product_category:categoryIds.get(p.category),product_unit:unitIds.get(p.unit),calculation_type:p.unit==="Adet"?"adet":p.unit==="Metrekare"?"m2":"mt",purchase_price:p.purchase_price,sale_price:p.sale_price,currency:p.currency||"TRY",stock_tracking:false,stock_quantity:0,variants:[],product_color:"",fabric_width_cm:Number(p.width_cm)||0,grammage_gr:Number(p.grammage_gr)||0}},upsert:true}})),{session,ordered:true});
        result={added:written.upsertedCount,existing:records.length-written.upsertedCount,total:records.length};
      });
    } finally {await session.endSession();}
    res.status(200).json({...result,message:`${result.added} ürün eklendi. ${result.existing} mevcut ürün korundu.`});
  } catch {
    console.error("Test kataloğu aktarımı başarısız.");
    res.status(500).json({message:"Katalog aktarımı tamamlanamadı. Mevcut ürünler korunur; aynı dosyayı tekrar aktarabilirsiniz."});
  }
}
