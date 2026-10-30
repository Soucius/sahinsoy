import test from 'node:test';
import assert from 'node:assert/strict';
import { assignOrderSewing, refreshSewingJobs, sewingOverride } from './orderSewing.js';
import { fingerprint, productionLines, visibleOrder, stageChoices } from './productionWorkflow.js';
import mongoose from 'mongoose';
import Sale from '../models/Sale.js';
import ProductionOrder from '../models/ProductionOrder.js';
import ProductionStaff from '../models/ProductionStaff.js';
import { updateOrderSewing, updateProductionJob, refreshProductionOrder } from '../controllers/production.controller.js';
const ids = { hayati: '100000000000000000000004', nurten: '100000000000000000000003', sale: '200000000000000000000001', order: '300000000000000000000001', first: '400000000000000000000001', second: '400000000000000000000002', product: '500000000000000000000001' };
const admin = { kind: 'admin', _id: '100000000000000000000001', name: 'TEST Yönetici' };
const worker = { kind: 'staff', _id: ids.hayati, name: 'Hayati', duties: ['sewing'] };
const fabric = (line_id, extra = {}) => ({ line_id, snapshot: { kind: 'textile', product_name: 'TEST Tül', width: 200, height: 260 }, stage: 'waiting', supply: 'awaiting_order', cutting: null, sewing: null, installation: null, ...extra });
const sale = () => ({ _id: ids.sale, status: 'tamamlandi', customer_name: 'TEST Müşteri', measurement_status: 'confirmed', measurement_revision: 0, delivery_method: 'store', grand_total: 20000, payments: [{ amount: 5000 }], sale_items: [ids.first, ids.second].map(_id => ({ _id, product: ids.product })), pos_details: { cart: [1,2].map(() => ({ product_id: ids.product, product_name: 'TEST Tül', mode: 'textile', width: 200, height: 260, quantity: 6.4 })) } });
const order = s => ({ _id: ids.order, sale: ids.sale, revision: 0, source_fingerprint: fingerprint(s), jobs: productionLines(s).map(line => ({ ...fabric(line.line_id), ...line })), history: [] });
const response = () => ({ statusCode: 200, status(code) { this.statusCode=code; return this; }, json(body) { this.body=body; return this; } });
function query(read) { return { select() {return this;}, populate() {return this;}, session() {return this;}, lean() {return this;}, then(resolve,reject) {return Promise.resolve().then(read).then(resolve,reject);} }; }
function database(t) {
  const s = sale(), state = { sale: s, order: order(s), writes: 0, active: true, duty: true };
  t.mock.method(mongoose,'startSession',async()=>({ async withTransaction(work) {const before=structuredClone(state);try {await work();} catch(e) {Object.assign(state,before);throw e;}},async endSession() {} }));
  t.mock.method(Sale,'findById',()=>query(()=>state.sale));
  t.mock.method(Sale,'updateOne',async(_filter,_change,options)=>{assert.equal(options.timestamps,false);state.writes++;});
  t.mock.method(ProductionOrder,'findById',()=>query(()=>state.order));
  t.mock.method(ProductionOrder,'findOneAndUpdate',(filter,change)=>query(()=>{if (state.order.revision!==filter.revision) return null;state.order={...state.order,...structuredClone(change.$set),revision:state.order.revision+1,history:[...state.order.history,structuredClone(change.$push.history)]};return structuredClone(state.order);}));
  t.mock.method(ProductionStaff,'findOne',filter=>query(()=>state.active && state.duty ? {_id:filter._id,active:true,duties:['sewing']} : null));
  return state;
}
const request = (revision=0, sewing=ids.hayati) => ({ params: {id:ids.order},body:{expected_revision:revision,sewing},productionActor:admin });
test('one selection assigns every open textile; materials and stages stay unchanged',()=>{
  const jobs=[fabric(ids.first),fabric(ids.second,{stage:'cut',supply:'received'}),{...fabric('mechanical'),snapshot:{kind:'mechanical'}}];
  const result=assignOrderSewing(jobs,ids.hayati);
  assert.deepEqual(result.map(j=>j.sewing),[ids.hayati,ids.hayati,null]);
  assert.deepEqual(result.map(j=>[j.stage,j.supply]),jobs.map(j=>[j.stage,j.supply]));
  assert.equal(jobs[0].sewing,null); assert.throws(()=>assignOrderSewing([jobs[2]],ids.hayati),/dikilecek/);
});
test('product exceptions, deliberate unassignment and completed wages retain their worker',()=>{
  const jobs=[fabric('a',{sewing:ids.nurten,sewing_override:true}),fabric('b',{sewing:null,sewing_override:true}),...['sewn','ready','installation','installed'].map(stage=>fabric(stage,{stage,sewing:ids.nurten}))];
  assert.deepEqual(assignOrderSewing(jobs,ids.hayati),jobs);
  assert.equal(sewingOverride(ids.nurten,ids.hayati),true); assert.equal(sewingOverride(null,ids.hayati),true); assert.equal(sewingOverride(ids.hayati,ids.hayati),false);
});
test('clearing a default only clears unfinished inherited assignments',()=>{
  const jobs=[fabric('a',{sewing:ids.hayati}),fabric('b',{sewing:ids.nurten,sewing_override:true}),fabric('c',{stage:'sewn',sewing:ids.hayati})];
  assert.deepEqual(assignOrderSewing(jobs,null).map(j=>j.sewing),[null,ids.nurten,ids.hayati]);
});
test('new products inherit only an active default; mechanical products never get a tailor',()=>{
  const record={jobs:[],sewing_default:ids.hayati},lines=[fabric('a'),{...fabric('b'),snapshot:{kind:'mechanical'}}];
  assert.equal(refreshSewingJobs(record,lines,true)[0].sewing,ids.hayati);
  assert.equal(refreshSewingJobs(record,lines,true)[1].sewing,null);
  assert.equal(refreshSewingJobs(record,lines,false)[0].sewing,null);
});
test('refresh preserves finished work and exceptions, resets only changed measurement stages',()=>{
  const jobs=[fabric('a',{stage:'ready',sewing:ids.nurten}),fabric('b',{sewing:ids.nurten,sewing_override:true}),fabric('c',{stage:'cutting',sewing:ids.hayati})];
  const record={jobs,sewing_default:ids.hayati},lines=jobs.map(j=>({...j,snapshot:{...j.snapshot}})); lines[2].snapshot.width=220;
  const result=refreshSewingJobs(record,lines,true);
  assert.equal(result[0].stage,'ready');assert.equal(result[0].sewing,ids.nurten);assert.equal(result[1].sewing,ids.nurten);assert.equal(result[2].stage,'waiting');assert.equal(result[2].snapshot.width,220);
});
test('controller persists the default atomically and keeps order money and stages',async t=>{
  const state=database(t), res=response(); await updateOrderSewing(request(),res);
  assert.equal(res.statusCode,200);assert.equal(state.order.sewing_default,ids.hayati);assert.ok(state.order.jobs.every(j=>j.sewing===ids.hayati));assert.ok(state.order.jobs.every(j=>j.stage==='waiting'));
  assert.equal(state.sale.grand_total,20000);assert.equal(state.sale.payments[0].amount,5000);assert.equal(state.order.history.length,1);assert.equal(res.body.sewing_default,ids.hayati);
});
test('staff cannot bulk assign even by calling the controller directly',async t=>{
  const state=database(t),res=response();await updateOrderSewing({...request(),productionActor:worker},res);assert.equal(res.statusCode,403);assert.equal(state.writes,0);assert.equal(state.order.revision,0);
});
test('inactive and wrong-duty staff, invalid fields, closed orders and stale revisions roll back',async t=>{
  const state=database(t);
  for (const scenario of ['inactive','wrong-duty','stale','closed','fields','source']) {
    state.active=scenario!=='inactive';state.duty=scenario!=='wrong-duty';state.sale.status=scenario==='closed'?'teslim_edildi':'tamamlandi';state.order.source_fingerprint=scenario==='source'?'old':fingerprint(state.sale);
    const req=request(scenario==='stale'?9:0);if(scenario==='fields')req.body.grand_total=1;
    const res=response();await updateOrderSewing(req,res);assert.ok([400,409].includes(res.statusCode),scenario);assert.equal(state.writes,0);assert.equal(state.order.revision,0);
  }
});
test('product-level reassignment stays an exception after order default changes',async t=>{
  const state=database(t);let res=response();await updateOrderSewing(request(),res);
  res=response();await updateProductionJob({params:{id:ids.order,lineId:ids.first},body:{expected_revision:1,changes:{sewing:ids.nurten}},productionActor:admin},res);
  assert.equal(res.statusCode,200);assert.equal(state.order.jobs[0].sewing_override,true);
  res=response();await updateOrderSewing(request(2,null),res);assert.equal(res.statusCode,200);assert.equal(state.order.jobs[0].sewing,ids.nurten);assert.equal(state.order.jobs[1].sewing,null);
});
test('saved default reaches a newly added line on refresh and staff sees only assigned work',async t=>{
  const state=database(t);await updateOrderSewing(request(),response());state.order.jobs[0].stage='ready';
  state.sale.sale_items.push({_id:'400000000000000000000003',product:ids.product});state.sale.pos_details.cart.push({...state.sale.pos_details.cart[0],product_name:'NEW TEST Tül'});
  const res=response();await refreshProductionOrder({params:{id:ids.order},body:{expected_revision:1},productionActor:admin},res);
  assert.equal(res.statusCode,200);assert.equal(state.order.jobs[0].stage,'ready');assert.equal(state.order.jobs[2].sewing,ids.hayati);assert.equal(state.order.jobs[2].stage,'waiting');
  const view=visibleOrder(state.order,state.sale,worker);assert.equal(view.jobs.length,3);assert.equal(view.sewing_default,undefined);assert.equal(view.history.length,0);assert.ok(!JSON.stringify(view).includes('grand_total'));
  assert.deepEqual(stageChoices(state.order.jobs[2],worker,state.sale),[]);
});
test('returning a product to the order default removes its exception',async t=>{
  const state=database(t);state.order.sewing_default=ids.hayati;state.order.jobs[0].sewing=ids.nurten;state.order.jobs[0].sewing_override=true;
  const res=response();await updateProductionJob({params:{id:ids.order,lineId:ids.first},body:{expected_revision:0,changes:{sewing:ids.hayati}},productionActor:admin},res);assert.equal(res.statusCode,200);assert.equal(state.order.jobs[0].sewing_override,false);
});
