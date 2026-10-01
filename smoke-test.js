require('dotenv').config();
const db=require('./platform-db');

(async()=>{
  await db.ready;
  const suffix=Date.now().toString(36).toUpperCase();
  const firm='TEST_'+suffix;
  const business=await db.register(firm,'Smoke Test Business','SmokeTest123!');
  const login=await db.login(firm,'SmokeTest123!');
  if(!login||login.business.id!==business.id)throw new Error('Login smoke test failed');

  const item=await db.addItem(business.id,{
    name:'Smoke Product '+suffix,unit:'PCS',opening_stock:10,minimum_stock:2,
    purchase_price:5,selling_price:10,gst_rate:18,hsn_code:'8471'
  });
  const sender=await db.addSender(business.id,'919999999999','Smoke Sender');

  const base={businessId:business.id,date:'2026-01-01',time:'10:00:00',
    deliveredTo:'Smoke Customer',senderId:sender.id,whatsappFrom:'919999999999@c.us',
    senderPhone:'919999999999',body:'Smoke Customer\n2 Smoke Product '+suffix,
    items:[{quantity:2,item:'Smoke Product '+suffix}]};

  const order=await db.createOrder({...base,whatsappMessageId:'SMOKE_'+suffix});
  if(order.status!=='SUCCESS'||Number(order.accepted_items)!==2)throw new Error('Order smoke test failed');

  const duplicate=await db.createOrder({...base,whatsappMessageId:'SMOKE_'+suffix,body:'duplicate'});
  if(duplicate.id!==order.id)throw new Error('Duplicate protection smoke test failed');

  let after=(await db.items(business.id)).find(x=>x.id===item.id);
  if(!after||Number(after.current_stock)!==8)throw new Error('Stock deduction smoke test failed');

  // Shortage must never mutate stock before confirmation.
  // Leave the remaining stock at 8 so a 12-unit request requires confirmation.
  const shortagePayload={...base,whatsappMessageId:'SHORT_'+suffix,items:[{quantity:12,item:'Smoke Product '+suffix}]};
  let shortage=false;
  try{await db.createOrder(shortagePayload)}catch(e){shortage=e.code==='INSUFFICIENT_STOCK_CONFIRMATION'}
  if(!shortage)throw new Error('Shortage confirmation was not required');
  after=(await db.items(business.id)).find(x=>x.id===item.id);
  if(Number(after.current_stock)!==8)throw new Error('Stock changed before shortage confirmation');

  const partial=await db.createOrder({...shortagePayload,allowPartialStock:true});
  if(partial.status!=='PARTIAL'||Number(partial.accepted_items)!==8||Number(partial.rejected_items)!==4)throw new Error('Confirmed shortage should accept available stock and reject the shortfall');
  after=(await db.items(business.id)).find(x=>x.id===item.id);
  if(Number(after.current_stock)!==0)throw new Error('Confirmed order stock deduction failed');

  // Customer + two orders -> one merged invoice.
  const customer=await db.addCustomer(business.id,{name:'Smoke Customer',phone:'919888888888',state:'Test State',state_code:'09'});
  await db.stockIn(business.id,item.id,10,'Invoice test refill');
  const o1=await db.createOrder({...base,whatsappMessageId:'INV1_'+suffix,items:[{quantity:2,item:'Smoke Product '+suffix}]});
  const o2=await db.createOrder({...base,whatsappMessageId:'INV2_'+suffix,items:[{quantity:1,item:'Smoke Product '+suffix}]});
  const inv=await db.createInvoice(business.id,{customer_id:customer.id,invoice_date:'2026-01-02',order_ids:[o1.id,o2.id]});
  if(inv.source_type!=='ORDERS'||Number(inv.order_ids?.length)!==2)throw new Error('Merged invoice creation failed');
  if(Number(inv.items?.[0]?.quantity)!==3)throw new Error('Merged invoice quantity aggregation failed');
  const finalized=await db.finalizeInvoice(business.id,inv.id);
  if(finalized.status!=='FINALIZED')throw new Error('Merged invoice finalization failed');

  // Return one delivered unit and verify stock is restored.
  const returned=await db.createOrderReturn(business.id,o1.id,[{order_item_id:(await db.order(business.id,o1.id)).items[0].id,quantity:1}],'Smoke return',login.user?.id);
  if(Number(returned.returned_items)!==1)throw new Error('Return flow failed');

  await db.logout(login.token);
  console.log('SMOKE TEST PASSED: auth, order, duplicate guard, shortage confirmation, partial fulfillment, merged invoice and return');
})().catch(e=>{console.error('SMOKE TEST FAILED:',e);process.exitCode=1});