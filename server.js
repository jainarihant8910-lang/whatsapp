require('dotenv').config();
const express=require('express'); const path=require('path'); const crypto=require('crypto'); const PDFDocument=require('pdfkit'); const db=require('./platform-db');
const app=express(); const PORT=Number(process.env.PORT)||3000; const PUBLIC=path.join(__dirname,'public');
const loginAttempts=new Map();
app.disable('x-powered-by');
app.use((req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','same-origin');
  if(req.path.startsWith('/api'))res.setHeader('Cache-Control','no-store');
  next();
});
app.use(express.json({limit:'3mb'})); app.use(express.urlencoded({extended:true})); app.use(express.static(PUBLIC));
function cookieToken(req){const m=String(req.headers.cookie||'').match(/(?:^|;)\s*dm_token=([^;]+)/);return m?decodeURIComponent(m[1]):''}
function bearerToken(req){const h=String(req.headers.authorization||'');return /^Bearer\s+/i.test(h)?h.replace(/^Bearer\s+/i,'').trim():''}
function sessionToken(req){return bearerToken(req)||cookieToken(req)}
async function auth(req,res,next){try{const token=sessionToken(req);const s=await db.session(token);if(!s)return res.status(401).json({error:'Login required'});req.authToken=token;req.session=s;req.businessId=s.business_id;req.userId=s.user_id;next()}catch(e){res.status(500).json({error:e.message})}}
function csrf(req,res,next){if(['GET','HEAD','OPTIONS'].includes(req.method))return next();const c=String(req.headers['x-csrf-token']||'');if(!c)return res.status(403).json({error:'CSRF token missing'});const token=sessionToken(req);if(!token)return res.status(401).json({error:'Login required'});db.get('SELECT csrf_hash FROM sessions WHERE token_hash=?',[crypto.createHash('sha256').update(token).digest('hex')]).then(s=>{if(!s||s.csrf_hash!==crypto.createHash('sha256').update(c).digest('hex'))return res.status(403).json({error:'Invalid CSRF token'});next()}).catch(e=>res.status(500).json({error:e.message}))}
function words(n){n=Math.round(Number(n)||0);const a=['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'],b=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];function x(v){if(v<20)return a[v];if(v<100)return b[Math.floor(v/10)]+' '+a[v%10];if(v<1000)return a[Math.floor(v/100)]+' Hundred '+x(v%100);if(v<100000)return x(Math.floor(v/1000))+' Thousand '+x(v%1000);if(v<10000000)return x(Math.floor(v/100000))+' Lakh '+x(v%100000);return x(Math.floor(v/10000000))+' Crore '+x(v%10000000)}return (x(n).replace(/\s+/g,' ').trim()||'Zero')+' Rupees Only'}
function pdfInvoice(res,title,biz,inv){
  const doc=new PDFDocument({size:'A4',margin:28,bufferPages:true});
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','inline; filename="'+title+'.pdf"');
  doc.pipe(res);

  const W=doc.page.width,L=28,R=W-28,CW=R-L;
  const money2=v=>Number(v||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
  const items=Array.isArray(inv.items)?inv.items:[];
  const drawLine=y=>{doc.moveTo(L,y).lineTo(R,y).stroke();};
  const cell=(x,y,w,h,text,opts={})=>{
    doc.rect(x,y,w,h).stroke();
    doc.fontSize(opts.size||7.2).font(opts.bold?'Helvetica-Bold':'Helvetica')
      .text(String(text??''),x+3,y+3,w-6,h-6,{align:opts.align||'left',lineBreak:false,ellipsis:true});
  };

  const cols=[
    {t:'Sr.',w:30,a:'center'},
    {t:'Product / Service',w:177},
    {t:'HSN / SAC',w:55,a:'center'},
    {t:'Qty',w:48,a:'center'},
    {t:'Rate',w:58,a:'right'},
    {t:'Taxable',w:67,a:'right'},
    {t:'GST',w:43,a:'right'},
    {t:'Total',w:CW-478,a:'right'}
  ];
  const rowH=23,headerH=22;

  const drawTitle=continued=>{
    doc.fontSize(16).font('Helvetica-Bold').text(continued?'TAX INVOICE — CONTINUED':'TAX INVOICE',L,24,CW,{align:'center'});
    doc.fontSize(7.5).font('Helvetica').text('ORIGINAL FOR RECIPIENT',L,43,CW,{align:'center'});
    let y=58;
    doc.fontSize(13).font('Helvetica-Bold').text(biz.name||'Business',L,y,CW,{align:'center'});
    y+=16;
    doc.fontSize(7.5).font('Helvetica').text('GSTIN: '+(biz.gstin||'-'),L,y,CW,{align:'center'});
    y+=11;
    doc.text(biz.address||'-',L,y,CW,{align:'center'});
    y+=16; drawLine(y); return y+6;
  };

  const drawInfo=(y)=>{
    const leftW=CW*0.57,rightW=CW-leftW,infoH=91;
    doc.rect(L,y,leftW,infoH).stroke();
    doc.rect(L+leftW,y,rightW,infoH).stroke();
    doc.fontSize(7.5).font('Helvetica-Bold').text('Customer Detail',L+6,y+6);
    doc.font('Helvetica').fontSize(7.5)
      .text('Customer: '+(inv.customer_name||'-'),L+6,y+20,leftW-12)
      .text('Address: '+(inv.customer_address||'-'),L+6,y+34,leftW-12)
      .text('Phone: '+(inv.customer_phone||'-'),L+6,y+48,leftW-12)
      .text('GSTIN: '+(inv.customer_gstin||'-'),L+6,y+62,leftW-12)
      .text('Place of Supply: '+(inv.place_of_supply||'-'),L+6,y+76,leftW-12);
    const rx=L+leftW+6;
    doc.fontSize(7.5)
      .text('Invoice No.: '+(inv.invoice_no||'-'),rx,y+9,rightW-12)
      .text('Invoice Date: '+(inv.invoice_date||'-'),rx,y+23,rightW-12)
      .text('Challan No.: '+(inv.challan_no||'-'),rx,y+37,rightW-12)
      .text('E-Way Bill No.: '+(inv.eway_bill_no||'-'),rx,y+51,rightW-12)
      .text('Transport: '+(inv.transport||'-'),rx,y+65,rightW-12);
    return y+infoH+8;
  };

  const drawTableHeader=y=>{
    let x=L;
    cols.forEach(c=>{cell(x,y,c.w,headerH,c.t,{bold:true,size:6.8,align:c.a||'center'});x+=c.w});
    return y+headerH;
  };

  const drawRows=(y,start,end)=>{
    for(let idx=start;idx<end;idx++){
      const it=items[idx]; let x=L;
      const vals=[
        idx+1,it.item_name||'-',it.hsn_code||'-',
        money2(it.quantity)+' '+(it.unit||'PCS'),
        money2(it.rate),money2(it.taxable_value),
        money2(it.total_tax),money2(it.line_total)
      ];
      cols.forEach((c,j)=>{cell(x,y,c.w,rowH,vals[j],{size:j===1?6.7:6.6,align:c.a||'left'});x+=c.w});
      y+=rowH;
    }
    return y;
  };

  const drawTotals=y=>{
    const totalVals=['','','','TOTAL',
      money2(items.reduce((a,x)=>a+Number(x.rate||0)*Number(x.quantity||0),0)),
      money2(inv.subtotal),
      money2(Number(inv.cgst||0)+Number(inv.sgst||0)+Number(inv.igst||0)),
      money2(inv.total)];
    let x=L; cols.forEach((c,j)=>{cell(x,y,c.w,22,totalVals[j],{bold:true,size:6.8,align:c.a||'right'});x+=c.w});
    return y+22;
  };

  const drawFinal=y0=>{
    let y=y0+8;
    const sumW=235;
    doc.font('Helvetica-Bold').fontSize(7.5).text('Tax Summary',L,y); y+=12;
    [['Taxable Amount',money2(inv.subtotal)],['CGST',money2(inv.cgst)],['SGST',money2(inv.sgst)],
     ['IGST',money2(inv.igst)],['Total Tax',money2(Number(inv.cgst)+Number(inv.sgst)+Number(inv.igst))],
     ['Total Amount After Tax','₹ '+money2(inv.total)]].forEach((r,k)=>{
      const h=k===5?22:17;
      cell(L,y,sumW/2,h,r[0],{bold:k===5,size:7});
      cell(L+sumW/2,y,sumW/2,h,r[1],{bold:k===5,size:7,align:'right'}); y+=h;
    });
    doc.font('Helvetica-Bold').fontSize(7.5).text('Total in words',L+sumW+18,y0+8);
    doc.font('Helvetica').fontSize(8).text(words(inv.total).toUpperCase(),L+sumW+18,y0+25,CW-sumW-18);
    doc.font('Helvetica').fontSize(7).text('Certified that the particulars given above are true and correct.',L,y+7,CW);
    return y+25;
  };

  const drawFooter=()=>{
    const h=86,top=doc.page.height-108;
    doc.moveTo(L,top).lineTo(R,top).stroke();
    doc.font('Helvetica-Bold').fontSize(7.5).text('Terms and Conditions',L,top+7);
    doc.font('Helvetica').fontSize(6.6).text('1. Goods once sold will not be taken back.\n2. Delivery subject to agreed terms.\n3. E. & O.E.',L,top+20,235);
    doc.font('Helvetica-Bold').fontSize(7.5).text('Customer Signature',L+255,top+7);
    doc.rect(L+255,top+20,95,38).stroke();
    doc.font('Helvetica-Bold').fontSize(7.5).text('For '+(biz.name||'Business'),R-145,top+7,145,{align:'right'});
    doc.rect(R-145,top+20,145,38).stroke();
    doc.font('Helvetica').fontSize(7).text('Authorised Signatory',R-145,top+62,145,{align:'right'});
    doc.fontSize(6.5).text('Thank you for shopping with us!',L,doc.page.height-23,CW,{align:'center'});
  };

  let pageNo=1;
  let y=drawTitle(false);
  y=drawInfo(y);
  y=drawTableHeader(y);

  // Reserve enough room for the final totals and footer. If everything fits,
  // the invoice stays on one professional page. Otherwise fill page 1 with
  // as many products as safely fit and continue the remaining products.
  const footerTop=doc.page.height-108;
  const finalReserve=174;
  const firstCapacity=Math.max(1,Math.floor((footerTop-finalReserve-y)/rowH));
  let start=0;

  if(items.length<=firstCapacity){
    y=drawRows(y,0,items.length);
    y=drawTotals(y);
    drawFinal(y);
    drawFooter();
  }else{
    let end=Math.min(items.length,start+Math.max(1,Math.floor((footerTop-y-6)/rowH)));
    y=drawRows(y,start,end);
    doc.font('Helvetica-Oblique').fontSize(6.8).text('Continued on next page…',L,y+5,CW,{align:'right'});
    drawFooter();
    start=end;

    while(start<items.length){
      doc.addPage();
      pageNo++;
      y=drawTitle(true);
      doc.font('Helvetica-Bold').fontSize(7).text('Invoice No.: '+(inv.invoice_no||'-')+'   |   Page '+pageNo,L,y,CW,{align:'right'});
      y+=13;
      y=drawTableHeader(y);

      const remaining=items.length-start;
      const isLast=remaining<=Math.max(1,Math.floor((footerTop-(y+finalReserve))/rowH));
      const cap=isLast
        ? Math.max(1,Math.floor((footerTop-finalReserve-y)/rowH))
        : Math.max(1,Math.floor((footerTop-y-8)/rowH));
      const end2=Math.min(items.length,start+cap);
      y=drawRows(y,start,end2);
      start=end2;

      if(start<items.length){
        doc.font('Helvetica-Oblique').fontSize(6.8).text('Continued on next page…',L,y+5,CW,{align:'right'});
        drawFooter();
      }else{
        y=drawTotals(y);
        drawFinal(y);
        drawFooter();
      }
    }
  }

  // Add page numbers after all pages have been generated.
  const range=doc.bufferedPageRange();
  for(let i=0;i<range.count;i++){
    doc.switchToPage(i);
    doc.font('Helvetica').fontSize(6.5).fillColor('#555')
      .text('Page '+(i+1)+' of '+range.count,L,doc.page.height-13,CW,{align:'right'});
  }
  doc.end();
}

app.get('/api/health',async(r,s)=>{try{await db.ready; s.json({ok:true})}catch(e){s.status(500).json({ok:false,error:e.message})}});
app.post('/api/auth/register',async(r,s)=>{try{await db.ready;s.status(201).json({success:true,business:await db.register(r.body.firm_id,r.body.name,r.body.password)})}catch(e){s.status(400).json({error:e.message})}});
app.post('/api/auth/login',async(r,s)=>{
  const key=String(r.ip||r.socket?.remoteAddress||'unknown');
  const now=Date.now(),windowMs=15*60*1000,max=20;
  const a=loginAttempts.get(key)||{count:0,reset:now+windowMs};
  if(now>a.reset){a.count=0;a.reset=now+windowMs}
  a.count++;loginAttempts.set(key,a);
  if(a.count>max)return s.status(429).json({error:'Too many login attempts. Try again later.'});
  try{
    await db.ready;const x=await db.login(r.body.firm_id,r.body.password);
    if(!x)return s.status(401).json({error:'Invalid Firm ID or password'});
    loginAttempts.delete(key);
    // The token is returned to the tab and stored in sessionStorage by the frontend.
    // Do not rely on a shared cookie for tenant identity: multiple businesses can
    // be open in separate browser tabs at the same time.
    try{require('./index').startBusiness(x.business.id).catch(e=>console.error('WhatsApp lazy startup:',e.message))}catch(e){console.error('WhatsApp worker load:',e.message)}
    s.json({success:true,token:x.token,csrf:x.csrf,business:x.business,user:x.user});
  }catch(e){s.status(500).json({error:e.message})}
});
app.post('/api/auth/logout',auth,csrf,async(r,s)=>{await db.logout(r.authToken);s.json({success:true})});
app.get('/api/auth/me',auth,async(r,s)=>{try{require('./index').startBusiness(r.businessId).catch(e=>console.error('WhatsApp lazy startup:',e.message))}catch(e){console.error('WhatsApp worker load:',e.message)}s.json({business:await db.business(r.businessId),user:{id:r.userId}})});
app.use('/api',auth); app.use('/api',csrf);
app.get('/api/dashboard',async(r,s)=>s.json(await db.dashboard(r.businessId)));
app.get('/api/analytics/sales',async(r,s)=>{try{s.json(await db.salesAnalytics(r.businessId,{from:r.query.from,to:r.query.to,product_id:r.query.product_id,customer:r.query.customer,source:r.query.source}))}catch(e){s.status(400).json({error:e.message})}});
app.get('/api/items',async(r,s)=>s.json({items:await db.items(r.businessId)}));
app.get('/api/hsn',async(r,s)=>s.json({hsn:await db.hsnMaster(r.businessId)}));
app.get('/api/hsn/search',async(r,s)=>{try{const q=String(r.query.q||'').trim();if(q.length<2)return s.status(400).json({error:'Enter at least 2 characters'});const base=process.env.HSN_LOOKUP_API_URL||'https://hsn.krakelabsindia.com/api/lookup';const u=new URL(base);u.searchParams.set('q',q);u.searchParams.set('limit','8');const ac=new AbortController();const timer=setTimeout(()=>ac.abort(),7000);let resp;try{resp=await fetch(u,{signal:ac.signal})}finally{clearTimeout(timer)}if(!resp.ok)throw Error('HSN lookup service returned '+resp.status);const data=await resp.json();const results=(data.results||data.matches||[]).map(x=>({hsn_code:String(x.hsn_sac||x.hsn_code||x.code||''),description:x.description||'',category:x.chapter||x.category||'',gst_rate:parseFloat(String(x.gst_rate||x.gst||'').replace('%',''))||0,confidence:x.confidence??null})).filter(x=>x.hsn_code);s.json({results,source:'external HSN/GST lookup'});}catch(e){s.status(502).json({error:'HSN lookup failed: '+(e.name==='AbortError'?'lookup timed out':e.message)})}});
app.post('/api/hsn',async(r,s)=>{try{s.status(201).json({hsn:await db.addHsn(r.businessId,r.body)})}catch(e){s.status(400).json({error:e.message})}});
app.put('/api/hsn/:id',async(r,s)=>{try{s.json({hsn:await db.updateHsn(r.businessId,Number(r.params.id),r.body)})}catch(e){s.status(400).json({error:e.message})}});
app.delete('/api/hsn/:id',async(r,s)=>{try{s.json(await db.deleteHsn(r.businessId,Number(r.params.id)))}catch(e){s.status(400).json({error:e.message})}});
app.get('/api/items/:id/aliases',async(r,s)=>s.json({aliases:await db.aliases(r.businessId,Number(r.params.id))}));
app.post('/api/items/:id/aliases',async(r,s)=>{try{s.status(201).json({alias:await db.addAlias(r.businessId,Number(r.params.id),r.body.alias)})}catch(e){s.status(400).json({error:e.message})}});
app.delete('/api/item-aliases/:id',async(r,s)=>{try{s.json(await db.deleteAlias(r.businessId,Number(r.params.id)))}catch(e){s.status(400).json({error:e.message})}});
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
app.get('/api/orders',async(r,s)=>s.json({orders:await db.orders(r.businessId)})); app.post('/api/orders/manual',async(r,s)=>{try{s.status(201).json({order:await db.createManualOrder(r.businessId,r.body)})}catch(e){s.status(400).json({error:e.message,code:e.code||''})}}); app.get('/api/orders/:id',async(r,s)=>{const o=await db.order(r.businessId,Number(r.params.id));if(!o)return s.status(404).json({error:'Order not found'});s.json({order:o})});

app.get('/api/orders/:id/returns',async(r,s)=>s.json({returns:await db.returnsForOrder(r.businessId,Number(r.params.id))}));
app.get('/api/invoice-orders',async(r,s)=>{try{s.json({orders:await db.ordersForCustomer(r.businessId,Number(r.query.customer_id))})}catch(e){s.status(400).json({error:e.message})}}); app.post('/api/orders/:id/returns',async(r,s)=>{try{s.json({order:await db.createOrderReturn(r.businessId,Number(r.params.id),r.body.items||[],r.body.reason||'',r.userId)})}catch(e){s.status(400).json({error:e.message})}});app.get('/api/invoices',async(r,s)=>s.json({invoices:await db.invoices(r.businessId)})); app.get('/api/invoices/:id',async(r,s)=>{const i=await db.invoice(r.businessId,Number(r.params.id));if(!i)return s.status(404).json({error:'Invoice not found'});s.json({invoice:i})});
app.post('/api/invoices',async(r,s)=>{try{s.status(201).json({invoice:await db.createInvoice(r.businessId,r.body)})}catch(e){s.status(400).json({error:e.message})}}); app.post('/api/invoices/:id/finalize',async(r,s)=>{try{s.json({invoice:await db.finalizeInvoice(r.businessId,Number(r.params.id))})}catch(e){s.status(400).json({error:e.message})}}); app.post('/api/invoices/:id/cancel',async(r,s)=>{try{s.json({invoice:await db.cancelInvoice(r.businessId,Number(r.params.id))})}catch(e){s.status(400).json({error:e.message})}});
app.get('/api/invoices/:id/pdf',async(r,s)=>{const i=await db.invoice(r.businessId,Number(r.params.id)),b=await db.business(r.businessId);if(!i)return s.status(404).end();pdfInvoice(s,'invoice-'+i.invoice_no,b,i)});
app.get('/api/orders/:id/invoice-pdf',async(r,s)=>{const o=await db.order(r.businessId,Number(r.params.id)),b=await db.business(r.businessId);if(!o)return s.status(404).end();const cust=await db.findCustomerByName(r.businessId,o.delivered_to);const items=o.items.filter(x=>Number(x.remaining_quantity)>0).map(x=>{const q=Number(x.remaining_quantity)||0;const rate=Number(x.rate)||0;const taxable=Math.round(q*rate*100)/100;const gst=Number(x.gst_rate)||0;const tax=Math.round(taxable*gst/100*100)/100;return {...x,quantity:q,taxable_value:taxable,total_tax:tax,line_total:Math.round((taxable+tax)*100)/100}});const tax=items.reduce((a,x)=>a+Number(x.total_tax||0),0);const subtotal=items.reduce((a,x)=>a+Number(x.taxable_value||0),0);const same=!!(b.state_code&&cust?.state_code&&b.state_code===cust.state_code);const inv={invoice_no:(b.invoice_prefix||'INV')+'-ORDER-'+String(o.id).padStart(4,'0'),invoice_date:o.date,customer_name:o.delivered_to,customer_address:cust?.address||'',customer_phone:cust?.phone||'',customer_gstin:cust?.gstin||'',place_of_supply:cust?.state?(cust.state+' '+(cust.state_code||'')): '',challan_no:'',challan_date:'',eway_bill_no:'',transport:'',subtotal,cgst:same?tax/2:0,sgst:same?tax/2:0,igst:same?0:tax,total:subtotal+tax,items};pdfInvoice(s,'invoice-order-'+o.id,b,inv)});
app.get('/api/whatsapp/status',async(r,s)=>{try{s.json({status:await db.waStatus(r.businessId)})}catch(e){s.status(500).json({error:e.message})}}); app.post('/api/whatsapp/restart',async(r,s)=>{try{const worker=require('./index');await worker.startBusiness(r.businessId,true);s.json({success:true})}catch(e){s.status(400).json({error:e.message})}});
app.post('/api/gst/preview',async(r,s)=>{try{s.json(await db.gstUpdatePreview(r.businessId,String(r.body.text||'')))}catch(e){s.status(400).json({error:e.message})}});
app.post('/api/gst/apply',async(r,s)=>{try{s.json({success:true,result:await db.applyGstUpdate(r.businessId,String(r.body.text||''),r.userId)})}catch(e){s.status(400).json({error:e.message})}});
app.get('/api/settings',async(r,s)=>s.json({business:await db.business(r.businessId)})); app.put('/api/settings',async(r,s)=>s.json({business:await db.updateBusiness(r.businessId,r.body)}));
app.get('/api/orders/:id/voice',async(r,s)=>{const o=await db.order(r.businessId,Number(r.params.id));if(!o)return s.status(404).end();s.json({text:'Order '+o.id+' for '+o.delivered_to+'. '+o.items.map(x=>x.item_name+' '+x.requested_quantity).join(', ')})});
app.use((r,s)=>{if(r.path.startsWith('/api'))return s.status(404).json({error:'API route not found'});s.sendFile(path.join(PUBLIC,'index.html'))});
app.use((e,r,s,n)=>{console.error(e);if(r.path.startsWith('/api'))return s.status(500).json({error:'Server error'});s.status(500).send('Server error')});
db.ready.then(async()=>{app.listen(PORT,'0.0.0.0',()=>console.log('Delivery Management Platform running on '+PORT));try{require('./index').startAll()}catch(e){console.error('WhatsApp worker:',e)}}).catch(e=>{console.error(e);process.exit(1)});
module.exports=app;