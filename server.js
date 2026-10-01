require('dotenv').config();
const express=require('express'); const path=require('path'); const crypto=require('crypto'); const PDFDocument=require('pdfkit'); const db=require('./platform-db');
const app=express(); const PORT=Number(process.env.PORT)||3000; const PUBLIC=path.join(__dirname,'public');
app.use(express.json({limit:'3mb'})); app.use(express.urlencoded({extended:true})); app.use(express.static(PUBLIC));
function cookieToken(req){const m=String(req.headers.cookie||'').match(/(?:^|;)\s*dm_token=([^;]+)/);return m?decodeURIComponent(m[1]):''}
async function auth(req,res,next){try{const s=await db.session(cookieToken(req));if(!s)return res.status(401).json({error:'Login required'});req.session=s;req.businessId=s.business_id;req.userId=s.user_id;next()}catch(e){res.status(500).json({error:e.message})}}
function csrf(req,res,next){if(['GET','HEAD','OPTIONS'].includes(req.method))return next();const c=String(req.headers['x-csrf-token']||'');if(!c)return res.status(403).json({error:'CSRF token missing'});db.get('SELECT csrf_hash FROM sessions WHERE token_hash=?',[crypto.createHash('sha256').update(cookieToken(req)).digest('hex')]).then(s=>{if(!s||s.csrf_hash!==crypto.createHash('sha256').update(c).digest('hex'))return res.status(403).json({error:'Invalid CSRF token'});next()}).catch(e=>res.status(500).json({error:e.message}))}
function words(n){n=Math.round(Number(n)||0);const a=['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'],b=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];function x(v){if(v<20)return a[v];if(v<100)return b[Math.floor(v/10)]+' '+a[v%10];if(v<1000)return a[Math.floor(v/100)]+' Hundred '+x(v%100);if(v<100000)return x(Math.floor(v/1000))+' Thousand '+x(v%1000);if(v<10000000)return x(Math.floor(v/100000))+' Lakh '+x(v%100000);return x(Math.floor(v/10000000))+' Crore '+x(v%10000000)}return (x(n).replace(/\s+/g,' ').trim()||'Zero')+' Rupees Only'}
function pdfInvoice(res,title,biz,inv){
  const doc=new PDFDocument({size:'A4',margin:32});
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','inline; filename="'+title+'.pdf"');
  doc.pipe(res);

  const W=doc.page.width, L=32, R=W-32, CW=R-L;
  const money2=v=>Number(v||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
  const drawLine=(y)=>{doc.moveTo(L,y).lineTo(R,y).stroke();};
  const cell=(x,y,w,h,text,opts={})=>{
    doc.rect(x,y,w,h).stroke();
    doc.fontSize(opts.size||7.5).font(opts.bold?'Helvetica-Bold':'Helvetica')
      .text(String(text??''),x+4,y+4,w-8,h-8,{align:opts.align||'left'});
  };

  doc.fontSize(17).font('Helvetica-Bold').text('TAX INVOICE',L,28,CW,{align:'center'});
  doc.fontSize(8).font('Helvetica').text('ORIGINAL FOR RECIPIENT',L,49,CW,{align:'center'});

  let y=68;
  doc.fontSize(15).font('Helvetica-Bold').text(biz.name||'Business',L,y,CW,{align:'center'});
  y+=19;
  doc.fontSize(8).font('Helvetica').text('GSTIN: '+(biz.gstin||'-'),L,y,CW,{align:'center'});
  y+=13;
  doc.text(biz.address||'-',L,y,CW,{align:'center'});
  y+=18;
  drawLine(y); y+=7;

  const leftW=CW*0.56, rightW=CW-leftW;
  const infoH=112;
  doc.rect(L,y,leftW,infoH).stroke();
  doc.rect(L+leftW,y,rightW,infoH).stroke();
  doc.fontSize(8).font('Helvetica-Bold').text('Customer Detail',L+7,y+7);
  doc.font('Helvetica').fontSize(8)
    .text('Customer: '+(inv.customer_name||'-'),L+7,y+23,leftW-14)
    .text('Address: '+(inv.customer_address||'-'),L+7,y+38,leftW-14)
    .text('Phone: '+(inv.customer_phone||'-'),L+7,y+53,leftW-14)
    .text('GSTIN: '+(inv.customer_gstin||'-'),L+7,y+68,leftW-14)
    .text('Place of Supply: '+(inv.place_of_supply||'-'),L+7,y+83,leftW-14);
  const rx=L+leftW+7;
  doc.font('Helvetica').fontSize(8)
    .text('Invoice No.: '+(inv.invoice_no||'-'),rx,y+10,rightW-14)
    .text('Invoice Date: '+(inv.invoice_date||'-'),rx,y+26,rightW-14)
    .text('Challan No.: '+(inv.challan_no||'-'),rx,y+42,rightW-14)
    .text('Challan Date: '+(inv.challan_date||'-'),rx,y+58,rightW-14)
    .text('E-Way Bill No.: '+(inv.eway_bill_no||'-'),rx,y+74,rightW-14)
    .text('Transport: '+(inv.transport||'-'),rx,y+90,rightW-14);
  y+=infoH+10;

  const cols=[
    {t:'Sr. No.',w:38,a:'center'},{t:'Name of Product / Service',w:150},
    {t:'HSN / SAC',w:58,a:'center'},{t:'Qty',w:45,a:'center'},
    {t:'Rate',w:62,a:'right'},{t:'Taxable Value',w:75,a:'right'},
    {t:'GST',w:45,a:'right'},{t:'Total',w:CW-473,a:'right'}
  ];
  const headerH=24;
  let x=L;
  cols.forEach(c=>{cell(x,y,c.w,headerH,c.t,{bold:true,size:7,align:c.a||'center'});x+=c.w});
  y+=headerH;
  const rowH=30;
  (inv.items||[]).forEach((it,idx)=>{
    x=L;
    const vals=[
      idx+1,
      it.item_name||'-',
      it.hsn_code||'-',
      money2(it.quantity)+' '+(it.unit||'PCS'),
      money2(it.rate),
      money2(it.taxable_value),
      money2(it.total_tax),
      money2(it.line_total)
    ];
    cols.forEach((c,j)=>{cell(x,y,c.w,rowH,vals[j],{size:j===1?7:7,align:c.a||'left'});x+=c.w});
    y+=rowH;
  });
  const totalVals=['','','','TOTAL',money2((inv.items||[]).reduce((a,x)=>a+Number(x.rate||0)*Number(x.quantity||0),0)),money2(inv.subtotal),money2((Number(inv.cgst||0)+Number(inv.sgst||0)+Number(inv.igst||0))),money2(inv.total)];
  x=L; cols.forEach((c,j)=>{cell(x,y,c.w,25,totalVals[j],{bold:true,size:7,align:c.a||'right'});x+=c.w}); y+=25;

  y+=10;
  const sumW=250;
  doc.font('Helvetica-Bold').fontSize(8).text('Tax Summary',L,y);
  y+=15;
  [['Taxable Amount',money2(inv.subtotal)],['CGST',money2(inv.cgst)],['SGST',money2(inv.sgst)],['IGST',money2(inv.igst)],['Total Tax',money2(Number(inv.cgst)+Number(inv.sgst)+Number(inv.igst))],['Total Amount After Tax','₹ '+money2(inv.total)]].forEach((r,k)=>{
    const h=k===5?24:19;
    cell(L,y,sumW/2,h,r[0],{bold:k===5,size:7.5});
    cell(L+sumW/2,y,sumW/2,h,r[1],{bold:k===5,size:7.5,align:'right'});
    y+=h;
  });
  doc.font('Helvetica-Bold').fontSize(8).text('Total in words',L+sumW+20,y-110);
  doc.font('Helvetica').fontSize(9).text(words(inv.total).toUpperCase(),L+sumW+20,y-92,CW-sumW-20);
  doc.font('Helvetica').fontSize(8).text('Certified that the particulars given above are true and correct.',L,y+10,CW);
  y+=38;

  const footerTop=Math.max(y,doc.page.height-145);
  doc.moveTo(L,footerTop).lineTo(R,footerTop).stroke();
  doc.font('Helvetica-Bold').fontSize(8).text('Terms and Conditions',L,footerTop+8);
  doc.font('Helvetica').fontSize(7)
    .text('1. Goods once sold will not be taken back.\n2. Delivery subject to agreed terms.\n3. E. & O.E.',L,footerTop+23,250);
  doc.font('Helvetica-Bold').fontSize(8).text('Customer Signature',L+270,footerTop+8);
  doc.rect(L+270,footerTop+22,110,45).stroke();
  doc.font('Helvetica-Bold').fontSize(8).text('For '+(biz.name||'Business'),R-150,footerTop+8,150,{align:'right'});
  doc.rect(R-150,footerTop+22,150,45).stroke();
  doc.font('Helvetica').fontSize(8).text('Authorised Signatory',R-150,footerTop+72,150,{align:'right'});
  doc.fontSize(7).text('Thank you for shopping with us!',L,doc.page.height-25,CW,{align:'center'});
  doc.end();
}
app.get('/api/health',async(r,s)=>{try{await db.ready; s.json({ok:true})}catch(e){s.status(500).json({ok:false,error:e.message})}});
app.post('/api/auth/register',async(r,s)=>{try{await db.ready;s.status(201).json({success:true,business:await db.register(r.body.firm_id,r.body.name,r.body.password)})}catch(e){s.status(400).json({error:e.message})}});
app.post('/api/auth/login',async(r,s)=>{try{await db.ready;const x=await db.login(r.body.firm_id,r.body.password);if(!x)return s.status(401).json({error:'Invalid Firm ID or password'});s.cookieToken=x.token;s.setHeader('Set-Cookie','dm_token='+encodeURIComponent(x.token)+'; HttpOnly; Path=/; SameSite=Lax'+(process.env.NODE_ENV==='production'?'; Secure':''));try{require('./index').startBusiness(x.business.id).catch(e=>console.error('WhatsApp lazy startup:',e.message))}catch(e){console.error('WhatsApp worker load:',e.message)}s.json({success:true,csrf:x.csrf,business:x.business,user:x.user})}catch(e){s.status(500).json({error:e.message})}});
app.post('/api/auth/logout',auth,csrf,async(r,s)=>{await db.logout(cookieToken(r));s.setHeader('Set-Cookie','dm_token=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');s.json({success:true})});
app.get('/api/auth/me',auth,async(r,s)=>{try{require('./index').startBusiness(r.businessId).catch(e=>console.error('WhatsApp lazy startup:',e.message))}catch(e){console.error('WhatsApp worker load:',e.message)}s.json({business:await db.business(r.businessId),user:{id:r.userId}})});
app.use('/api',auth); app.use('/api',csrf);
app.get('/api/dashboard',async(r,s)=>s.json(await db.dashboard(r.businessId)));
app.get('/api/items',async(r,s)=>s.json({items:await db.items(r.businessId)}));
app.post('/api/items',async(r,s)=>{try{s.status(201).json({item:await db.addItem(r.businessId,r.body)})}catch(e){s.status(400).json({error:e.message})}});
app.put('/api/items/:id',async(r,s)=>{try{s.json({item:await db.editItem(r.businessId,Number(r.params.id),r.body)})}catch(e){s.status(400).json({error:e.message})}});
app.delete('/api/items/:id',async(r,s)=>{try{s.json(await db.deleteItem(r.businessId,Number(r.params.id)))}catch(e){s.status(400).json({error:e.message})}});
app.post('/api/items/:id/stock',async(r,s)=>{try{s.json({item:await db.stockIn(r.businessId,Number(r.params.id),r.body.quantity,r.body.reason)})}catch(e){s.status(400).json({error:e.message})}});
app.get('/api/transactions',async(r,s)=>s.json({transactions:await db.transactions(r.businessId)}));
app.get('/api/senders',async(r,s)=>s.json({senders:await db.senders(r.businessId)}));
app.post('/api/senders',async(r,s)=>{try{s.status(201).json({sender:await db.addSender(r.businessId,r.body.phone,r.body.name)})}catch(e){s.status(400).json({error:e.message})}});
app.put('/api/senders/:id',async(r,s)=>{try{s.json({sender:await db.editSender(r.businessId,Number(r.params.id),r.body.phone,r.body.name)})}catch(e){s.status(400).json({error:e.message})}});
app.delete('/api/senders/:id',async(r,s)=>{try{await db.delSender(r.businessId,Number(r.params.id));s.json({success:true})}catch(e){s.status(400).json({error:e.message})}});
app.get('/api/customers',async(r,s)=>s.json({customers:await db.customers(r.businessId)})); app.post('/api/customers',async(r,s)=>{try{s.status(201).json({customer:await db.addCustomer(r.businessId,r.body)})}catch(e){s.status(400).json({error:e.message})}});
app.get('/api/orders',async(r,s)=>s.json({orders:await db.orders(r.businessId)})); app.get('/api/orders/:id',async(r,s)=>{const o=await db.order(r.businessId,Number(r.params.id));if(!o)return s.status(404).json({error:'Order not found'});s.json({order:o})});

app.get('/api/orders/:id/returns',async(r,s)=>s.json({returns:await db.returnsForOrder(r.businessId,Number(r.params.id))}));
app.post('/api/orders/:id/returns',async(r,s)=>{try{s.json({order:await db.createOrderReturn(r.businessId,Number(r.params.id),r.body.items||[],r.body.reason||'',r.userId)})}catch(e){s.status(400).json({error:e.message})}});app.get('/api/invoices',async(r,s)=>s.json({invoices:await db.invoices(r.businessId)})); app.get('/api/invoices/:id',async(r,s)=>{const i=await db.invoice(r.businessId,Number(r.params.id));if(!i)return s.status(404).json({error:'Invoice not found'});s.json({invoice:i})});
app.post('/api/invoices',async(r,s)=>{try{s.status(201).json({invoice:await db.createInvoice(r.businessId,r.body)})}catch(e){s.status(400).json({error:e.message})}}); app.post('/api/invoices/:id/finalize',async(r,s)=>{try{s.json({invoice:await db.finalizeInvoice(r.businessId,Number(r.params.id))})}catch(e){s.status(400).json({error:e.message})}}); app.post('/api/invoices/:id/cancel',async(r,s)=>{try{s.json({invoice:await db.cancelInvoice(r.businessId,Number(r.params.id))})}catch(e){s.status(400).json({error:e.message})}});
app.get('/api/invoices/:id/pdf',async(r,s)=>{const i=await db.invoice(r.businessId,Number(r.params.id)),b=await db.business(r.businessId);if(!i)return s.status(404).end();pdfInvoice(s,'invoice-'+i.invoice_no,b,i)});
app.get('/api/orders/:id/invoice-pdf',async(r,s)=>{const o=await db.order(r.businessId,Number(r.params.id)),b=await db.business(r.businessId);if(!o)return s.status(404).end();const cust=await db.findCustomerByName(r.businessId,o.delivered_to);const items=o.items.filter(x=>Number(x.remaining_quantity)>0).map(x=>{const q=Number(x.remaining_quantity)||0;const rate=Number(x.rate)||0;const taxable=Math.round(q*rate*100)/100;const gst=Number(x.gst_rate)||0;const tax=Math.round(taxable*gst/100*100)/100;return {...x,quantity:q,taxable_value:taxable,total_tax:tax,line_total:Math.round((taxable+tax)*100)/100}});const tax=items.reduce((a,x)=>a+Number(x.total_tax||0),0);const subtotal=items.reduce((a,x)=>a+Number(x.taxable_value||0),0);const same=!!(b.state_code&&cust?.state_code&&b.state_code===cust.state_code);const inv={invoice_no:(b.invoice_prefix||'INV')+'-ORDER-'+String(o.id).padStart(4,'0'),invoice_date:o.date,customer_name:o.delivered_to,customer_address:cust?.address||'',customer_phone:cust?.phone||'',customer_gstin:cust?.gstin||'',place_of_supply:cust?.state?(cust.state+' '+(cust.state_code||'')): '',challan_no:'',challan_date:'',eway_bill_no:'',transport:'',subtotal,cgst:same?tax/2:0,sgst:same?tax/2:0,igst:same?0:tax,total:subtotal+tax,items};pdfInvoice(s,'invoice-order-'+o.id,b,inv)});
app.get('/api/whatsapp/status',async(r,s)=>{try{s.json({status:await db.waStatus(r.businessId)})}catch(e){s.status(500).json({error:e.message})}}); app.post('/api/whatsapp/restart',async(r,s)=>{try{const worker=require('./index');await worker.startBusiness(r.businessId,true);s.json({success:true})}catch(e){s.status(400).json({error:e.message})}});
app.get('/api/settings',async(r,s)=>s.json({business:await db.business(r.businessId)})); app.put('/api/settings',async(r,s)=>s.json({business:await db.updateBusiness(r.businessId,r.body)}));
app.get('/api/orders/:id/voice',async(r,s)=>{const o=await db.order(r.businessId,Number(r.params.id));if(!o)return s.status(404).end();s.json({text:'Order '+o.id+' for '+o.delivered_to+'. '+o.items.map(x=>x.item_name+' '+x.requested_quantity).join(', ')})});
app.use((r,s)=>{if(r.path.startsWith('/api'))return s.status(404).json({error:'API route not found'});s.sendFile(path.join(PUBLIC,'index.html'))});
app.use((e,r,s,n)=>{console.error(e);if(r.path.startsWith('/api'))return s.status(500).json({error:'Server error'});s.status(500).send('Server error')});
db.ready.then(async()=>{app.listen(PORT,'0.0.0.0',()=>console.log('Delivery Management Platform running on '+PORT));try{require('./index').startAll()}catch(e){console.error('WhatsApp worker:',e)}}).catch(e=>{console.error(e);process.exit(1)});
module.exports=app;