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
    name:'Smoke Product '+suffix,
    unit:'PCS',
    opening_stock:10,
    minimum_stock:2,
    purchase_price:5,
    selling_price:10,
    gst_rate:18
  });
  const sender=await db.addSender(business.id,'919999999999','Smoke Sender');

  const order=await db.createOrder({
    businessId:business.id,date:'2026-01-01',time:'10:00:00',
    deliveredTo:'Smoke Customer',senderId:sender.id,
    whatsappMessageId:'SMOKE_'+suffix,whatsappFrom:'919999999999@c.us',
    senderPhone:'919999999999',body:'Smoke Customer\\n2 Smoke Product '+suffix,
    items:[{quantity:2,item:'Smoke Product '+suffix}]
  });
  if(order.status!=='SUCCESS'||order.accepted_items!==1)throw new Error('Order smoke test failed');
  const duplicate=await db.createOrder({
    businessId:business.id,date:'2026-01-01',time:'10:00:00',
    deliveredTo:'Smoke Customer',senderId:sender.id,
    whatsappMessageId:'SMOKE_'+suffix,whatsappFrom:'919999999999@c.us',
    senderPhone:'919999999999',body:'duplicate',
    items:[{quantity:2,item:'Smoke Product '+suffix}]
  });
  if(duplicate.id!==order.id)throw new Error('Duplicate protection smoke test failed');
  const after=await db.items(business.id);
  const saved=after.find(x=>x.id===item.id);
  if(!saved||Number(saved.current_stock)!==8)throw new Error('Stock deduction smoke test failed');

  await db.logout(login.token);
  console.log('SMOKE TEST PASSED');
})().catch(e=>{console.error('SMOKE TEST FAILED:',e);process.exitCode=1});
