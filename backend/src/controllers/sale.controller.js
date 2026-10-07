import mongoose from "mongoose";
import Sale from "../models/Sale.js";
import Product from "../models/Product.js";
import {normalizeSale,SaleInputError} from "../libs/sale-validation.js";
const allowed=['sale_items','sub_total','discount_amount','discount_percent','credit_card_fee','grand_total','payment_method','status','customer_name','customer_phone','customer_address','delivery_date','delivery_method','sale_note','pos_details','client_request_id'];
const pick=data=>Object.fromEntries(allowed.filter(k=>data[k]!==undefined).map(k=>[k,data[k]]));
const populate=q=>q.populate({path:'sale_items.product',select:'product_name product_barcode product_image calculation_type product_unit product_category product_brand stock_tracking stock_quantity sale_price variants currency',populate:[{path:'product_unit',select:'unit_name unit_code'},{path:'product_category',select:'category_name'},{path:'product_brand',select:'brand_name'}]}).populate('sold_by','user_username');
async function deductStock(items,session){
  const quantities=new Map();
  for(const x of items)quantities.set(String(x.product),(quantities.get(String(x.product))||0)+x.quantity);
  for(const [id,quantity] of quantities){
    const product=await Product.findById(id).session(session);
    if(!product)throw new SaleInputError('Siparişteki bir ürün artık bulunmuyor.',404);
    if(product.stock_tracking===false)continue;
    const updated=await Product.updateOne({_id:id,stock_quantity:{$gte:quantity}},{$inc:{stock_quantity:-quantity}},{session});
    if(updated.modifiedCount!==1)throw new SaleInputError(`${product.product_name} için stok yetersiz. Mevcut: ${product.stock_quantity}`);
  }
}
function failure(error,res){
  if(error instanceof SaleInputError)return res.status(error.status).json({message:error.message});
  console.error('Sipariş kaydı tamamlanamadı.');
  return res.status(500).json({message:'Sipariş kaydı tamamlanamadı. Yeniden denemeden önce sipariş takibini kontrol edin.'});
}
export async function createSale(req,res){
  const session=await mongoose.startSession();
  try{
    const data=normalizeSale(pick(req.body));
    if(data.client_request_id&&!/^[a-zA-Z\d_-]{8,100}$/.test(data.client_request_id))throw new SaleInputError('İşlem kimliği geçersiz.');
    let saved;
    await session.withTransaction(async()=>{
      if(data.client_request_id){const prior=await Sale.findOne({client_request_id:data.client_request_id,sold_by:req.user._id}).session(session);if(prior){saved=prior;return;}}
      const sale=new Sale({...data,sold_by:req.user._id,approved_at:data.status==='tamamlandi'?new Date():null,lost_at:data.status==='kaybedildi'?new Date():null});await sale.validate();
      if(data.status==='tamamlandi')await deductStock(data.sale_items,session);
      saved=await sale.save({session});
    });res.status(201).json(saved);
  }catch(error){
    if(error.code===11000&&req.body.client_request_id){const prior=await Sale.findOne({client_request_id:req.body.client_request_id,sold_by:req.user._id});if(prior)return res.status(200).json(prior);}
    failure(error,res);
  }finally{await session.endSession();}
}
export async function getAllSales(req,res){
  try{const filter=req.query.status?{status:req.query.status}:{};res.json(await populate(Sale.find(filter).sort({createdAt:-1})));}catch(error){failure(error,res);}
}
export async function updateSale(req,res){
  const session=await mongoose.startSession();
  try{
    let savedId;
    await session.withTransaction(async()=>{
      const existing=await Sale.findById(req.params.id).session(session);
      if(!existing)throw new SaleInputError('Sipariş bulunamadı.',404);
      if(existing.status==='tamamlandi'){
        const financial=Object.keys(req.body).filter(k=>!['sale_items'].includes(k));
        if(financial.length){if(req.body.status==='tamamlandi'){savedId=existing._id;return;}throw new SaleInputError('Onaylanmış siparişin tutarı ve durumu değiştirilemez.');}
        if(req.body.sale_items){if(req.body.sale_items.length!==existing.sale_items.length)throw new SaleInputError('Onaylanmış siparişin ürünleri değiştirilemez.');existing.sale_items.forEach((x,i)=>{x.is_ordered=req.body.sale_items[i]?.is_ordered===true;});await existing.save({session});}
        savedId=existing._id;return;
      }
      const combined={...pick(existing.toObject()),...pick(req.body)};
      if(!existing.pos_details&&existing.discount_amount>0&&!('discount_percent' in req.body))delete combined.discount_percent;
      const data=normalizeSale(combined);
      Object.assign(existing,data);await existing.validate();
      if(data.status==='tamamlandi')existing.approved_at=new Date();
      if(data.status==='kaybedildi'&&!existing.lost_at)existing.lost_at=new Date();
      if(data.status==='tamamlandi')await deductStock(data.sale_items,session);
      await existing.save({session});savedId=existing._id;
    });res.json(await populate(Sale.findById(savedId)));
  }catch(error){failure(error,res);}finally{await session.endSession();}
}
