import { paymentConversion } from './curtainCalculation.js';
import { validateDualPliseGroups } from './dualPlise.js';

export class SaleInputError extends Error { constructor(message,status=400){super(message);this.status=status;} }
const round=x=>Math.round((x+Number.EPSILON)*100)/100;
const finite=(x,min=0)=>typeof x==='number'&&Number.isFinite(x)&&x>=min;
export function normalizeSale(input){
  if(!Array.isArray(input.sale_items)||!input.sale_items.length||input.sale_items.length>1000)throw new SaleInputError('Sepete en az bir ürün ekleyin.');
  const items=input.sale_items.map(x=>{
    const id=typeof x.product==='object'?x.product?._id:x.product;
    if(!/^[a-f\d]{24}$/i.test(String(id))||!finite(x.quantity,0.000001)||!finite(x.unit_price)||!finite(x.total_price)||!finite(x.width??0)||!finite(x.height??0))throw new SaleInputError('Siparişte geçersiz ürün, ölçü veya fiyat var.');
    if(Math.abs(round(x.quantity*x.unit_price)-round(x.total_price))>.05)throw new SaleInputError('Ürün satır tutarı ile miktar ve birim fiyat uyuşmuyor.');
    return {...x,product:id};
  });
  const subtotal=round(items.reduce((s,x)=>s+x.total_price,0));
  const discount=input.discount_amount??0,fee=input.credit_card_fee??0;
  if(!finite(discount)||discount>subtotal||!finite(fee)||!finite(input.grand_total)||Math.abs(round(input.grand_total)-round(subtotal-discount+fee))>.05||!finite(input.sub_total)||Math.abs(input.sub_total-subtotal)>.05)throw new SaleInputError('Sipariş toplamı ve iskonto tutarı uyuşmuyor.');
  const status=input.status||'tamamlandi';
  if(!['beklemede','tamamlandi','kaybedildi'].includes(status))throw new SaleInputError('Sipariş durumu geçersiz.');
  const percent=input.discount_percent??(subtotal?round(discount/subtotal*100):0);
  if(!finite(percent)||percent>100||('discount_percent' in input&&Math.abs(round(subtotal*percent/100)-discount)>.05))throw new SaleInputError('İskonto yüzdesi ve tutarı uyuşmuyor.');
  const grandTotal=round(subtotal-discount+fee);
  let details=input.pos_details;
  if(details&&typeof details==='object'&&!Array.isArray(details)){
    try {
      const cart=details.cart;
      if(Array.isArray(cart)&&cart.some(line=>line&&Object.prototype.hasOwnProperty.call(line,'dual_plise'))){
        validateDualPliseGroups(cart);
        if(cart.length!==items.length)throw new Error('Çiftli plise ürünleri ile sipariş satırları eşleşmiyor.');
        cart.forEach((line,index)=>{
          if(!line||typeof line!=='object'||Array.isArray(line))throw new Error('Çiftli plise ürünleri ile sipariş satırları eşleşmiyor.');
          const item=items[index];
          const product=typeof line.product_id==='object'?line.product_id?._id:line.product_id;
          if(String(product)!==String(item.product)||['quantity','width','height','unit_price'].some(key=>!finite(line[key])||Math.abs(line[key]-item[key])>.000001)||!finite(line.item_total)||Math.abs(round(line.item_total)-round(item.total_price))>.01)throw new Error('Çiftli plise ürünleri ile sipariş satırları eşleşmiyor.');
        });
      }
      const payment=paymentConversion(grandTotal,details.header||{});
      details={...details};
      if(payment.currency!=='TRY')details.payment_conversion=payment;
      else delete details.payment_conversion;
    } catch(error) {throw new SaleInputError(error.message);}
  }
  return {...input,...(details?{pos_details:details}:{}),sale_items:items,sub_total:subtotal,discount_amount:round(discount),discount_percent:percent,credit_card_fee:round(fee),grand_total:grandTotal,status};
}
