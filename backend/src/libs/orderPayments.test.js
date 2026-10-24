import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Sale from '../models/Sale.js';
import LedgerAccount from '../models/LedgerAccount.js';
import { newLedgerAccount } from './accountLedger.js';
import { paymentEntry, paymentVoid, paymentSummary } from './orderPayments.js';
import { addSalePayment, voidSalePayment } from '../controllers/salePayment.controller.js';
import { buildMeasurementRevision, measurementFormForLine } from './orderMeasurement.js';
import { calculateCurtainLine, defaultMeasurement, salePayload } from './curtainCalculation.js';
import { createCustomerOrderHtml, createManufacturingHtml } from '../../../frontend/src/libs/curtainPrint.js';
const user='000000000000000000000001',id='000000000000000000000002',productId='000000000000000000000003';
const ledgerId='000000000000000000000004';
const date='2026-10-19';
const base=(extra={})=>({_id:id,status:'tamamlandi',grand_total:20000,payments:[],payment_revision:0,...extra});
const input=(extra={})=>({request_id:'payment-test-0001',expected_revision:0,amount:5000,method:'Nakit',kind:'Kapora',paid_date:date,note:'',...(extra.method === 'Mail Order' ? { company: 'SYNTHETIC SUPPLIER', ledger_account_id: ledgerId } : {}),...extra});
function add(sale,body){const result=paymentEntry(sale,body,user);if(!result.existing){sale.payments.push(result.entry);sale.payment_revision++;}return result;}

test('cash deposit, card, bank and mail order payments are independent and all reduce the remaining balance',()=>{
 const sale=base();
 for(const [index,method] of ['Nakit','Kredi Kartı','Havale / EFT','Mail Order'].entries()){
  add(sale,input({request_id:`payment-test-${index}`,expected_revision:index,method,kind:index?'Teslimat ödemesi':'Kapora'}));
  assert.equal(sale.grand_total,20000);assert.equal(paymentSummary(sale).balance,20000-(index+1)*5000);
 }
 assert.equal(paymentSummary(sale).paid,20000);assert.equal(sale.payments[3].method,'Mail Order');
 assert.equal(paymentSummary(sale).credit,0);
});
test('full payment up front and zero outstanding balance are supported',()=>{
 const sale=base();add(sale,input({amount:20000,kind:'Tam ödeme'}));
 assert.equal(paymentSummary(sale).balance,0);
 assert.throws(()=>paymentEntry(sale,input({request_id:'payment-second',amount:.01,expected_revision:1}),user),/bakiyeden/);
});
test('idempotent requests cannot double-record payments or change a previous amount or method',()=>{
 const sale=base();add(sale,input());assert.equal(add(sale,input()).existing,true);
 assert.equal(sale.payments.length,1);assert.equal(sale.payment_revision,1);
 assert.throws(()=>add(sale,input({amount:6000})),/farklı/);
 assert.throws(()=>add(sale,input({method:'Mail Order'})),/farklı/);
});
test('stale revisions and pending, lost or cancelled orders cannot accept new payments',()=>{
 for(const status of ['beklemede','kaybedildi','iptal'])assert.throws(()=>paymentEntry(base({status}),input(),user),/onaylanmış/);
 assert.doesNotThrow(()=>paymentEntry(base({status:'teslim_edildi'}),input(),user));
 assert.throws(()=>paymentEntry(base({payment_revision:1}),input(),user),/başka/);
});
test('invalid amounts, extra fields, impossible dates and unsupported methods are rejected',()=>{
 for(const amount of [0,-1,Infinity,NaN,5000.001,'5000',20000.01])assert.throws(()=>paymentEntry(base(),input({amount}),user));
 for(const paid_date of ['bad','2026-02-30','2026-1-1'])assert.throws(()=>paymentEntry(base(),input({paid_date}),user));
 assert.throws(()=>paymentEntry(base(),input({payment_method:'Nakit'}),user));
 assert.throws(()=>paymentEntry(base(),input({method:'Other'}),user));
 assert.throws(()=>paymentEntry(base(),input({note:'x'.repeat(501)}),user));
});
test('voiding an erroneous payment preserves its amount, method and audit trail while restoring the balance',()=>{
 const sale=base();add(sale,input());
 const result=paymentVoid(sale,'payment-test-0001',{expected_revision:1,reason:'Yanlış tutar kaydı'},user);
 Object.assign(result.entry,result.changes);sale.payment_revision++;
 assert.equal(sale.payments.length,1);assert.equal(sale.payments[0].amount,5000);
 assert.equal(sale.payments[0].method,'Nakit');assert.equal(sale.payments[0].void_reason,'Yanlış tutar kaydı');
 assert.equal(paymentSummary(sale).paid,0);assert.equal(paymentSummary(sale).balance,20000);
 assert.equal(paymentVoid(sale,'payment-test-0001',{expected_revision:1,reason:'Tekrar'},user).existing,true);
 assert.equal(add(sale,input()).existing,true);assert.equal(paymentSummary(sale).paid,0);
});
test('cancelled or reduced orders expose customer credit rather than silently losing the deposit',()=>{
 const sale=base();add(sale,input());sale.status='iptal';
 assert.equal(paymentSummary(sale).balance,0);assert.equal(paymentSummary(sale).credit,5000);
 sale.status='tamamlandi';sale.grand_total=4000;
 assert.equal(paymentSummary(sale).credit,1000);assert.equal(paymentSummary(sale).paid,5000);
});
test('old orders do not infer receipts from the planned payment method',()=>{
 assert.equal(paymentSummary({grand_total:20000,payment_method:'Kredi Kartı'}).paid,0);
 assert.equal(paymentSummary({grand_total:20000}).balance,20000);
});
function memory(t,initial,failSave=false){
 let stored=structuredClone(initial),writes=0,active=false;
 let ledger={_id:ledgerId,...newLedgerAccount({operation_id:'11111111-1111-4111-8111-111111111111',name:'SYNTHETIC SUPPLIER',category:'supplier',currency:'TRY',opening_date:'2026-10-01',opening_amount:'100000',opening_direction:'owe'}, {_id:user,name:'TEST'})};
 t.mock.method(mongoose,'startSession',async()=>({withTransaction:async(run)=>{const before=structuredClone(stored),beforeLedger=structuredClone(ledger);active=true;try{await run();}catch(error){stored=before;ledger=beforeLedger;throw error;}finally{active=false;}},endSession:async()=>{}}));
 const read=()=>{const doc=new Sale(stored);doc.save=async(options)=>{assert.equal(active,true);assert.ok(options.session);await doc.validate();stored=JSON.parse(JSON.stringify(doc));writes++;if(failSave)throw new Error('Simulated storage failure');return doc;};return doc;};
 t.mock.method(Sale,'findById',()=>({session:async()=>{assert.equal(active,true);return read();},populate:async()=>read()}));
 t.mock.method(LedgerAccount,'findById',lookup=>({session:session=>{assert.ok(session);return {lean:async()=>{assert.equal(active,true);return lookup===ledgerId?structuredClone(ledger):null;}};}}));
 t.mock.method(LedgerAccount,'findOneAndUpdate',(filter,update,options)=>({lean:async()=>{
  assert.equal(active,true);assert.ok(options.session);
  if(filter.revision!==ledger.revision||ledger.entries.some(entry=>entry.operation_id===filter['entries.operation_id'].$ne))return null;
  ledger={...ledger,...update.$set,revision:ledger.revision+1,entries:[...ledger.entries,update.$push.entries]};
  await new LedgerAccount(ledger).validate();return structuredClone(ledger);
 }}));
 return {stored:()=>stored,writes:()=>writes,ledger:()=>ledger};
}
const record=()=>({...base(),sold_by:user,sale_items:[{product:productId,quantity:1,unit_price:20000,total_price:20000}],sub_total:20000});
async function call(handler,body,params={id},role='Yönetici'){const response={code:200,status(code){this.code=code;return this;},json(data){this.data=JSON.parse(JSON.stringify(data));return this;}};await handler({params,user:{_id:user,user_username:'TEST',user_role:{role_name:role}},body},response);return response;}
test('controller transaction saves one payment on retries and the protected ledger schema retains all fields',async(t)=>{
 const db=memory(t,record());let response=await call(addSalePayment,input());assert.equal(response.code,200);assert.equal(db.writes(),1);
 response=await call(addSalePayment,input());assert.equal(response.code,200);assert.equal(db.writes(),1);
 assert.equal(response.data.payments[0].recorded_by,user);assert.equal(response.data.payment_revision,1);
 assert.equal(response.data.grand_total,20000);assert.equal(paymentSummary(response.data).balance,15000);
});
test('controller rejects competing stale submissions without writing and allows a refreshed split payment',async(t)=>{
 const db=memory(t,record());await call(addSalePayment,input());
 let response=await call(addSalePayment,input({request_id:'different-pay-id',method:'Mail Order',amount:10000}));
 assert.equal(response.code,409);assert.equal(db.writes(),1);
 response=await call(addSalePayment,input({request_id:'different-pay-id',expected_revision:1,method:'Mail Order',amount:10000}));
 assert.equal(response.code,200);assert.equal(paymentSummary(db.stored()).balance,5000);
 response=await call(addSalePayment,input({request_id:'last-pay-id',expected_revision:2,amount:5001}));assert.equal(response.code,400);assert.equal(db.writes(),2);
});
test('controller void is idempotent, audited and cannot change the underlying sale amount',async(t)=>{
 const db=memory(t,record());await call(addSalePayment,input());
 let response=await call(voidSalePayment,{expected_revision:1,reason:'Test düzeltmesi'},{id,paymentId:'payment-test-0001'});
 assert.equal(response.code,200);assert.equal(paymentSummary(response.data).paid,0);assert.equal(db.writes(),2);
 response=await call(voidSalePayment,{expected_revision:1,reason:'Test düzeltmesi'},{id,paymentId:'payment-test-0001'});
 assert.equal(response.code,200);assert.equal(db.writes(),2);assert.equal(response.data.payments.length,1);assert.equal(response.data.grand_total,20000);
});
test('customer paper shows all payment methods, received and remaining amounts while factory paper omits them',()=>{
 const product={_id:productId,product_name:'Örnek Tül',category_name:'Tül',calculation_type:'mt',sale_price:1000};
 const line={...calculateCurtainLine(product,{...defaultMeasurement(product),width:720,height:260}),id:'payment-fabric'};
 const sale={...salePayload([line],{first_name:'TEST',delivery_method:'magaza'},0,'tamamlandi','payment-paper'),payments:[],payment_revision:0};
 add(sale,input());add(sale,input({request_id:'mail-order-test',expected_revision:1,method:'Mail Order',amount:7000,kind:'Teslimat ödemesi'}));
 const html=createCustomerOrderHtml(sale),factory=createManufacturingHtml(sale);
 for(const value of ['Kapora','Mail Order','Nakit','₺12.000,00','₺10.000,00'])assert.ok(html.includes(value));
 assert.ok(!factory.includes('Tahsilat'));assert.ok(!factory.includes('Mail Order'));
 const revision=buildMeasurementRevision(sale,{measurements:[{...measurementFormForLine(line),width:820}]});
 const revised={...sale,...revision};assert.equal(paymentSummary(revised).paid,12000);assert.equal(paymentSummary(revised).balance,revision.grand_total-12000);
});

test('delivery never marks unpaid balances as collected and pending payments remain visible until actually paid',()=>{
 const sale=base();add(sale,input());sale.status='teslim_edildi';
 assert.equal(paymentSummary(sale).statusLabel,'Ödeme beklemede');assert.equal(paymentSummary(sale).balance,15000);
 add(sale,input({request_id:'delivery-rest',expected_revision:1,amount:15000,method:'Mail Order',kind:'Teslimat ödemesi'}));
 assert.equal(paymentSummary(sale).statusLabel,'Ödeme tamamlandı');assert.equal(sale.status,'teslim_edildi');
});

test('mail order company is retained, validated and part of idempotency without affecting the balance',()=>{
 const sale=base();add(sale,input({method:'Mail Order',company:' OBA Perdesan '}));
 assert.equal(sale.payments[0].company,'OBA Perdesan');assert.equal(paymentSummary(sale).balance,15000);
 assert.equal(add(sale,input({method:'Mail Order',company:'OBA Perdesan'})).existing,true);
 assert.throws(()=>add(sale,input({method:'Mail Order',company:'DMR Line'})),/farklı/);
 assert.throws(()=>paymentEntry(base(),input({company:'OBA Perdesan'}),user),/yalnız/);
 for(const company of ['x'.repeat(121),{},'bad\u0000name'])assert.throws(()=>paymentEntry(base(),input({method:'Mail Order',company}),user));
 const legacy=base({payments:[{...input(),recorded_by:user,recorded_at:new Date()}],payment_revision:1});
 assert.equal(add(legacy,input()).existing,true);
});

test('company survives the controller and schema, stays internal and is preserved on correction',async(t)=>{
 const db=memory(t,record());
 let response=await call(addSalePayment,input({method:'Mail Order',company:'INTERNAL_FIRM_TEST'}));
 assert.equal(response.code,200);assert.equal(db.stored().payments[0].company,'INTERNAL_FIRM_TEST');
 assert.ok(!createCustomerOrderHtml(response.data).includes('INTERNAL_FIRM_TEST'));
 response=await call(voidSalePayment,{expected_revision:1,reason:'Deneme düzeltmesi'},{id,paymentId:'payment-test-0001'});
 assert.equal(response.code,200);assert.equal(response.data.payments[0].company,'INTERNAL_FIRM_TEST');assert.equal(paymentSummary(response.data).paid,0);
});


test('payment and requested physical delivery commit together, retry once and retain outstanding balance',async(t)=>{
 const db=memory(t,record());const body=input({mark_delivered:true});
 let response=await call(addSalePayment,body);
 assert.equal(response.code,200);assert.equal(response.data.status,'teslim_edildi');
 assert.equal(response.data.delivered_by,user);assert.ok(response.data.delivered_at);assert.ok(response.data.approved_at);
 assert.equal(response.data.payments[0].mark_delivered,true);assert.equal(paymentSummary(response.data).balance,15000);
 const deliveredAt=response.data.delivered_at;
 response=await call(addSalePayment,body);assert.equal(db.writes(),1);assert.equal(response.data.delivered_at,deliveredAt);
 response=await call(addSalePayment,{...body,mark_delivered:false});assert.equal(response.code,409);assert.equal(db.writes(),1);
 response=await call(voidSalePayment,{expected_revision:1,reason:'Yanlış ödeme kaydı'},{id,paymentId:body.request_id});
 assert.equal(response.data.status,'teslim_edildi');assert.equal(response.data.delivered_at,deliveredAt);assert.equal(paymentSummary(response.data).paid,0);
});
test('full payment never implies delivery when the optional checkbox is not selected',async(t)=>{
 const db=memory(t,record());const response=await call(addSalePayment,input({amount:20000,kind:'Tam ödeme'}));
 assert.equal(response.code,200);assert.equal(db.stored().status,'tamamlandi');assert.equal(db.stored().delivered_at,null);
 assert.equal(paymentSummary(response.data).balance,0);
});
test('delivery and payment both roll back on a failed atomic save',async(t)=>{
 const original=record(),db=memory(t,original,true);const response=await call(addSalePayment,input({mark_delivered:true}));
 assert.equal(response.code,500);assert.equal(db.stored().status,'tamamlandi');assert.deepEqual(db.stored().payments,[]);assert.equal(db.stored().payment_revision,0);
});
test('later receipts preserve original delivery audit and delivery intent must be boolean',async(t)=>{
 const original={...record(),status:'teslim_edildi',delivered_at:'2026-10-01T10:00:00.000Z',delivered_by:user};
 const db=memory(t,original);const response=await call(addSalePayment,input({mark_delivered:true}));
 assert.equal(response.code,200);assert.equal(db.stored().delivered_at,original.delivered_at);
 for(const mark_delivered of ['true',1,null,{}])assert.throws(()=>paymentEntry(base(),input({mark_delivered}),user),/Teslim/);
});

test('mail order atomically reduces customer and supplier debt, including replay and void',async(t)=>{
 const db=memory(t,record()), body=input({method:'Mail Order',amount:14000});
 let response=await call(addSalePayment,body);
 assert.equal(response.code,200); assert.equal(paymentSummary(response.data).balance,6000);
 assert.equal(response.data.payments[0].ledger_account_id,ledgerId);
 assert.equal(db.ledger().balance_minor,'8600000'); assert.equal(db.ledger().entries[1].type,'mail_order');
 response=await call(addSalePayment,body); assert.equal(response.code,200);
 assert.equal(db.writes(),1); assert.equal(db.ledger().entries.length,2);
 response=await call(voidSalePayment,{expected_revision:1,reason:'Wrong receipt'},{id,paymentId:body.request_id});
 assert.equal(response.code,200); assert.equal(db.ledger().balance_minor,'10000000');
 assert.equal(paymentSummary(response.data).balance,20000); assert.equal(db.ledger().entries.length,3);
 response=await call(voidSalePayment,{expected_revision:1,reason:'Wrong receipt'},{id,paymentId:body.request_id});
 assert.equal(response.code,200); assert.equal(db.ledger().entries.length,3);
});
test('failed sale save rolls back supplier credit as well as the receipt and delivery',async(t)=>{
 const db=memory(t,record(),true);
 const response=await call(addSalePayment,input({method:'Mail Order',mark_delivered:true}));
 assert.equal(response.code,500); assert.equal(db.ledger().balance_minor,'10000000');
 assert.equal(db.ledger().entries.length,1); assert.equal(db.stored().payments.length,0);
 assert.equal(db.stored().status,'tamamlandi');
});
test('unlinked, missing-account or unauthorized mail orders cannot save half a payment',async(t)=>{
 const db=memory(t,record());
 for(const changes of [{ledger_account_id:''},{company:''},{ledger_account_id:'999999999999999999999999'}]) {
  const response=await call(addSalePayment,input({method:'Mail Order',...changes}));
  assert.equal(response.code,409); assert.equal(db.writes(),0); assert.equal(db.ledger().entries.length,1);
 }
 assert.equal((await call(addSalePayment,input({method:'Mail Order'}),{id},'Satış Temsilcisi')).code,403);
 assert.equal(db.stored().payments.length,0);
 assert.throws(()=>paymentEntry(base(),input({ledger_account_id:ledgerId}),user),/cari hesabını/);
});
test('cash/card/bank receipts leave supplier debt unchanged and legacy mail orders are never backfilled',async(t)=>{
 const db=memory(t,record());
 for(const [i,method] of ['Nakit','Kredi Kartı','Havale / EFT'].entries()) {
  assert.equal((await call(addSalePayment,input({method,request_id:`non-mail-order-${i}`,expected_revision:i,amount:1000}))).code,200);
 }
 assert.equal(db.ledger().entries.length,1); assert.equal(db.ledger().balance_minor,'10000000');
});
test('replaying and correcting a pre-integration receipt does not deduct its historical opening twice',async(t)=>{
 const body=input({method:'Mail Order',ledger_account_id:''});
 const legacy=record(); legacy.payments=[paymentEntry(legacy,body,user).entry]; legacy.payment_revision=1;
 const db=memory(t,legacy);
 assert.equal((await call(addSalePayment,body)).code,200); assert.equal(db.ledger().entries.length,1);
 assert.equal((await call(voidSalePayment,{expected_revision:1,reason:'Legacy correction'},{id,paymentId:body.request_id})).code,200);
 assert.equal(db.ledger().balance_minor,'10000000'); assert.equal(db.ledger().entries.length,1);
});
