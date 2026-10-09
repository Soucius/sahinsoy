import mongoose from "mongoose";
import Sale from "../models/Sale.js";
import Product from "../models/Product.js";
import {normalizeSale,SaleInputError} from "../libs/sale-validation.js";
import {buildMeasurementRevision} from "../libs/orderMeasurement.js";
const allowed=['sale_items','sub_total','discount_amount','discount_percent','credit_card_fee','grand_total','payment_method','status','customer_name','customer_phone','customer_address','delivery_date','delivery_method','sale_note','pos_details','client_request_id','measurement_status'];
const pick=data=>Object.fromEntries(allowed.filter(k=>data[k]!==undefined).map(k=>[k,data[k]]));
const populate=q=>q.populate({path:'sale_items.product',select:'product_name product_barcode product_image calculation_type product_unit product_category product_brand stock_tracking stock_quantity sale_price variants currency',populate:[{path:'product_unit',select:'unit_name unit_code'},{path:'product_category',select:'category_name'},{path:'product_brand',select:'brand_name'}]}).populate('sold_by','user_username').populate('measurement_history.changed_by','user_username');
async function deductStock(items,session){
  const quantities=new Map();
  const deductions=[];
  for(const x of items)quantities.set(String(x.product),(quantities.get(String(x.product))||0)+x.quantity);
  for(const [id,quantity] of quantities){
    const product=await Product.findById(id).session(session);
    if(!product)throw new SaleInputError('Siparişteki bir ürün artık bulunmuyor.',404);
    if(product.stock_tracking===false)continue;
    const updated=await Product.updateOne({_id:id,stock_quantity:{$gte:quantity}},{$inc:{stock_quantity:-quantity}},{session});
    if(updated.modifiedCount!==1)throw new SaleInputError(`${product.product_name} için stok yetersiz. Mevcut: ${product.stock_quantity}`);
    deductions.push({product:product._id,quantity});
  }
  return deductions;
}
async function restoreStock(sale,session){
  // A missing ledger on an old order does not prove a historical stock deduction.
  if(!Array.isArray(sale.stock_deductions))return true;
  // Check every product first: missing products defer the whole refund for review.
  for(const entry of sale.stock_deductions){
    if(!await Product.findById(entry.product).session(session))return true;
  }
  for(const entry of sale.stock_deductions){
    const restored=await Product.updateOne({_id:entry.product},{$inc:{stock_quantity:entry.quantity}},{session});
    if(restored.modifiedCount!==1)throw new SaleInputError('Stok iadesi tamamlanamadı; sipariş iptal edilmedi.',409);
  }
  return false;
}
function initialMeasurementStatus(input){
  if(input.measurement_status!==undefined&&!['preliminary','confirmed'].includes(input.measurement_status))throw new SaleInputError('İlk ölçü durumu ön ölçü veya teyit edilmiş ölçü olmalıdır. Ölçü randevusunu ayrı ekrandan kaydedin.');
  return input;
}

function measurementInput(body,revision){
  if(!body||typeof body!=='object'||Array.isArray(body))throw new SaleInputError('Ölçü bilgilerini kontrol edin.');
  const fields=['measurement_date','measurement_master','measurement_note','expected_revision',...(revision?['measurements','client_request_id']:[])];
  if(Object.keys(body).some(key=>!fields.includes(key)))throw new SaleInputError('Bu ekranda yalnız ölçü ve randevu bilgileri güncellenebilir.');
  if(!Number.isSafeInteger(body.expected_revision)||body.expected_revision<0)throw new SaleInputError('Ölçü sürümü geçersiz; siparişi yeniden açın.');
  const result={expected_revision:body.expected_revision};
  for(const [key,max] of [['measurement_master',120],['measurement_note',2000]]){
    if(body[key]===undefined)continue;
    if(typeof body[key]!=='string'||body[key].length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(body[key]))throw new SaleInputError(key==='measurement_master'?'Usta adını kontrol edin.':'Ölçü notunu kontrol edin.');
    result[key]=body[key].trim();
  }
  if(body.measurement_date!==undefined){
    if(body.measurement_date===null||body.measurement_date==='')result.measurement_date=null;
    else{
      if(typeof body.measurement_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(body.measurement_date))throw new SaleInputError('Ölçü tarihini gün-ay-yıl olarak seçin.');
      const date=new Date(`${body.measurement_date}T00:00:00.000Z`);
      if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==body.measurement_date)throw new SaleInputError('Ölçü tarihi geçersiz.');
      result.measurement_date=date;
    }
  }
  if(revision){
    if(typeof body.client_request_id!=='string'||!/^[a-zA-Z\d_-]{8,100}$/.test(body.client_request_id))throw new SaleInputError('Ölçü işleminin kimliği geçersiz.');
    result.client_request_id=body.client_request_id;
    result.measurements=body.measurements;
  }
  return result;
}

function measurementSnapshot(sale){
  const raw=sale.toObject();
  const fields=['measurement_status','measurement_date','measurement_master','measurement_note','measurement_revision','pos_details','sale_items','sub_total','discount_amount','discount_percent','credit_card_fee','grand_total','stock_deductions'];
  // Clone Mixed fields before replacing them: both sides of the audit must remain immutable.
  return JSON.parse(JSON.stringify(Object.fromEntries(fields.map(key=>[key,raw[key]??null]))));
}

function editableMeasurement(sale,input){
  if(!['beklemede','tamamlandi'].includes(sale.status))throw new SaleInputError('Yalnız bekleyen veya onaylanmış siparişin ölçüsü güncellenebilir. Teslim edilmiş, iptal edilmiş veya kaybedilmiş sipariş değiştirilemez.',409);
  if((sale.measurement_revision||0)!==input.expected_revision)throw new SaleInputError('Bu siparişin ölçü bilgileri başka bir ekranda değişti. Siparişi yeniden açıp güncel ölçüleri kontrol edin.',409);
}

function aggregateQuantities(items){
  const result=new Map();
  for(const item of items){
    const id=String(item.product?._id||item.product);
    result.set(id,Math.round(((result.get(id)||0)+item.quantity)*1000000)/1000000);
  }
  return result;
}

async function reviseStockDeductions(sale,newItems,session){
  const oldQuantities=aggregateQuantities(sale.sale_items);
  const newQuantities=aggregateQuantities(newItems);
  const quantityChanged=[...new Set([...oldQuantities.keys(),...newQuantities.keys()])].some(id=>Math.abs((newQuantities.get(id)||0)-(oldQuantities.get(id)||0))>0.0000001);
  if(!quantityChanged)return;
  if(!Array.isArray(sale.stock_deductions))throw new SaleInputError('Bu eski siparişin stok düşüm kaydı bilinmiyor. Miktarı değiştirmeden önce stok hareketini yöneticiyle doğrulayın.',409);
  const ledger=new Map();
  for(const entry of sale.stock_deductions){
    const id=String(entry.product);
    ledger.set(id,Math.round(((ledger.get(id)||0)+entry.quantity)*1000000)/1000000);
  }
  const changes=[];
  for(const [id,deducted] of ledger){
    const oldQuantity=oldQuantities.get(id)||0,newQuantity=newQuantities.get(id)||0;
    const delta=Math.round((newQuantity-oldQuantity)*1000000)/1000000;
    if(!delta)continue;
    if(Math.abs(deducted-oldQuantity)>0.0000001)throw new SaleInputError('Siparişin stok düşüm miktarı kayıtlı ürün miktarıyla uyuşmuyor. Ölçü değişikliğinden önce stok hareketini yöneticiyle doğrulayın.',409);
    const product=await Product.findById(id).session(session);
    if(!product)throw new SaleInputError('Ölçüsü değişen stok ürünü bulunamıyor; sipariş güncellenmedi.',409);
    changes.push({id,delta,newQuantity,name:product.product_name});
  }
  for(const change of changes){
    const filter={_id:change.id,...(change.delta>0?{stock_quantity:{$gte:change.delta}}:{})};
    const updated=await Product.updateOne(filter,{$inc:{stock_quantity:-change.delta}},{session});
    if(updated.modifiedCount!==1)throw new SaleInputError(change.delta>0?`${change.name} için yeni ölçünün gerektirdiği ek stok yetersiz; sipariş güncellenmedi.`:'Ölçü değişikliğinin stok iadesi tamamlanamadı; sipariş güncellenmedi.',409);
    ledger.set(change.id,change.newQuantity);
  }
  // A known empty ledger means the original approval did not deduct tracked stock.
  sale.stock_deductions=[...ledger].filter(([,quantity])=>quantity>0).map(([product,quantity])=>({product,quantity}));
}

function recordMeasurement(sale,input,kind,userId,before){
  for(const key of ['measurement_date','measurement_master','measurement_note'])if(input[key]!==undefined)sale[key]=input[key];
  sale.measurement_status=kind==='measurement'?'confirmed':sale.measurement_date?'scheduled':'preliminary';
  sale.measurement_revision=(sale.measurement_revision||0)+1;
  sale.measurement_history.push({kind,revision:sale.measurement_revision,request_id:input.client_request_id||'',changed_at:new Date(),changed_by:userId,before,after:measurementSnapshot(sale)});
}
function failure(error,res){
  if(error instanceof SaleInputError)return res.status(error.status).json({message:error.message});
  console.error('Sipariş kaydı tamamlanamadı.');
  return res.status(500).json({message:'Sipariş kaydı tamamlanamadı. Yeniden denemeden önce sipariş takibini kontrol edin.'});
}
export async function createSale(req,res){
  const session=await mongoose.startSession();
  try{
    const data=normalizeSale(initialMeasurementStatus(pick(req.body)));
    if(data.client_request_id&&!/^[a-zA-Z\d_-]{8,100}$/.test(data.client_request_id))throw new SaleInputError('İşlem kimliği geçersiz.');
    let saved;
    await session.withTransaction(async()=>{
      if(data.client_request_id){const prior=await Sale.findOne({client_request_id:data.client_request_id,sold_by:req.user._id}).session(session);if(prior){saved=prior;return;}}
      const sale=new Sale({...data,sold_by:req.user._id,approved_at:data.status==='tamamlandi'?new Date():null,lost_at:data.status==='kaybedildi'?new Date():null});await sale.validate();
      if(data.status==='tamamlandi')sale.stock_deductions=await deductStock(data.sale_items,session);
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
      if(existing.status==='iptal')throw new SaleInputError('İptal edilmiş sipariş değiştirilemez. Yeni bir sipariş oluşturun.',409);
      if(existing.status==='teslim_edildi')throw new SaleInputError('Teslim edilmiş sipariş değiştirilemez.',409);
      if(existing.status==='tamamlandi'){
        const financial=Object.keys(req.body).filter(k=>!['sale_items'].includes(k));
        if(financial.length){if(req.body.status==='tamamlandi'){savedId=existing._id;return;}throw new SaleInputError('Onaylanmış siparişin tutarı ve durumu değiştirilemez.');}
        if(req.body.sale_items){if(req.body.sale_items.length!==existing.sale_items.length)throw new SaleInputError('Onaylanmış siparişin ürünleri değiştirilemez.');existing.sale_items.forEach((x,i)=>{x.is_ordered=req.body.sale_items[i]?.is_ordered===true;});await existing.save({session});}
        savedId=existing._id;return;
      }
      const combined={...pick(existing.toObject()),...initialMeasurementStatus(pick(req.body))};
      if(!existing.pos_details&&existing.discount_amount>0&&!('discount_percent' in req.body))delete combined.discount_percent;
      const data=normalizeSale(combined);
      Object.assign(existing,data);await existing.validate();
      if(data.status==='tamamlandi')existing.approved_at=new Date();
      if(data.status==='kaybedildi'&&!existing.lost_at)existing.lost_at=new Date();
      if(data.status==='tamamlandi')existing.stock_deductions=await deductStock(data.sale_items,session);
      await existing.save({session});savedId=existing._id;
    });res.json(await populate(Sale.findById(savedId)));
  }catch(error){failure(error,res);}finally{await session.endSession();}
}

export async function cancelSale(req,res){
  const session=await mongoose.startSession();
  try{
    let savedId;
    await session.withTransaction(async()=>{
      const sale=await Sale.findById(req.params.id).session(session);
      if(!sale)throw new SaleInputError('Sipariş bulunamadı.',404);
      if(sale.status==='iptal'){savedId=sale._id;return;}
      if(sale.status==='teslim_edildi')throw new SaleInputError('Teslim edilmiş sipariş iptal edilemez.',409);
      sale.stock_restoration_pending=sale.status==='tamamlandi'?await restoreStock(sale,session):false;
      sale.status='iptal';
      sale.cancelled_at=new Date();
      sale.cancelled_by=req.user._id;
      await sale.save({session});
      savedId=sale._id;
    });
    res.json(await populate(Sale.findById(savedId)));
  }catch(error){failure(error,res);}finally{await session.endSession();}
}

export async function deliverSale(req,res){
  const session=await mongoose.startSession();
  try{
    let savedId;
    await session.withTransaction(async()=>{
      const sale=await Sale.findById(req.params.id).session(session);
      if(!sale)throw new SaleInputError('Sipariş bulunamadı.',404);
      if(sale.status==='teslim_edildi'){savedId=sale._id;return;}
      if(sale.status!=='tamamlandi')throw new SaleInputError('Yalnız onaylanmış sipariş teslim edildi olarak işaretlenebilir.',409);
      // Delivery is fulfillment, so retain the original approval month and stock.
      if(!sale.approved_at)sale.approved_at=sale.updatedAt||sale.createdAt||new Date();
      sale.status='teslim_edildi';
      sale.delivered_at=new Date();
      sale.delivered_by=req.user._id;
      await sale.save({session});
      savedId=sale._id;
    });
    res.json(await populate(Sale.findById(savedId)));
  }catch(error){failure(error,res);}finally{await session.endSession();}
}

export async function planSaleMeasurement(req,res){
  const session=await mongoose.startSession();
  try{
    const input=measurementInput(req.body,false);
    let savedId;
    await session.withTransaction(async()=>{
      const sale=await Sale.findById(req.params.id).session(session);
      if(!sale)throw new SaleInputError('Sipariş bulunamadı.',404);
      editableMeasurement(sale,input);
      const before=measurementSnapshot(sale);
      recordMeasurement(sale,input,'plan',req.user._id,before);
      await sale.save({session});savedId=sale._id;
    });
    res.json(await populate(Sale.findById(savedId)));
  }catch(error){failure(error,res);}finally{await session.endSession();}
}

export async function reviseSaleMeasurements(req,res){
  const session=await mongoose.startSession();
  try{
    const input=measurementInput(req.body,true);
    let savedId;
    await session.withTransaction(async()=>{
      const sale=await Sale.findById(req.params.id).session(session);
      if(!sale)throw new SaleInputError('Sipariş bulunamadı.',404);
      // A successful request stays successful even after a later plan, delivery or cancellation.
      // Replaying it must never recreate stock writes or restore an old geometry snapshot.
      if(sale.measurement_history.some(entry=>entry.request_id===input.client_request_id)){savedId=sale._id;return;}
      editableMeasurement(sale,input);
      const before=measurementSnapshot(sale);
      const products=[];
      for(const id of aggregateQuantities(sale.sale_items).keys()){
        const product=await Product.findById(id).session(session);
        if(product)products.push(typeof product.toObject==='function'?product.toObject():product);
      }
      let revision;
      try{revision=buildMeasurementRevision(sale.toObject(),{measurements:input.measurements},products);}
      catch(error){throw new SaleInputError(error.message||'Yeni ölçüleri kontrol edin.',400);}
      const fields=['sale_items','pos_details','sub_total','discount_amount','discount_percent','credit_card_fee','grand_total'];
      // Validate the same monetary invariants as order creation; preserve headers and payments.
      const data=normalizeSale({...pick(sale.toObject()),...Object.fromEntries(fields.map(key=>[key,revision[key]]))});
      if(sale.status==='tamamlandi')await reviseStockDeductions(sale,data.sale_items,session);
      for(const key of fields)sale[key]=data[key];
      recordMeasurement(sale,input,'measurement',req.user._id,before);
      await sale.save({session});savedId=sale._id;
    });
    res.json(await populate(Sale.findById(savedId)));
  }catch(error){failure(error,res);}finally{await session.endSession();}
}
