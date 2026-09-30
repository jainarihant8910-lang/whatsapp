require('dotenv').config();
const express=require('express'); const path=require('path'); const crypto=require('crypto'); const fs=require('fs'); const os=require('os'); const {spawn}=require('child_process'); const sharp=require('sharp'); const multer=require('multer'); const pdfParse=require('pdf-parse'); const Tesseract=require('tesseract.js'); const PDFDocument=require('pdfkit'); const db=require('./platform-db');
const app=express(); const PORT=Number(process.env.PORT)||3000; const PUBLIC=path.join(__dirname,'public');
app.use(express.json({limit:'3mb'})); app.use(express.urlencoded({extended:true})); app.use(express.static(PUBLIC));
function cookieToken(req){const m=String(req.headers.cookie||'').match(/(?:^|;)\s*dm_token=([^;]+)/);return m?decodeURIComponent(m[1]):''}
async function auth(req,res,next){try{const s=await db.session(cookieToken(req));if(!s)return res.status(401).json({error:'Login required'});req.session=s;req.businessId=s.business_id;req.userId=s.user_id;next()}catch(e){res.status(500).json({error:e.message})}}
function csrf(req,res,next){if(['GET','HEAD','OPTIONS'].includes(req.method))return next();const c=String(req.headers['x-csrf-token']||'');if(!c)return res.status(403).json({error:'CSRF token missing'});db.get('SELECT csrf_hash FROM sessions WHERE token_hash=?',[crypto.createHash('sha256').update(cookieToken(req)).digest('hex')]).then(s=>{if(!s||s.csrf_hash!==crypto.createHash('sha256').update(c).digest('hex'))return res.status(403).json({error:'Invalid CSRF token'});next()}).catch(e=>res.status(500).json({error:e.message}))}
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:25*1024*1024},fileFilter:(r,f,cb)=>cb(null,['application/pdf','image/jpeg','image/png','image/webp'].includes(f.mimetype))});
function hash(buf){return crypto.createHash('sha256').update(buf).digest('hex')}
async function normalizeImageForOcr(buf){
  return sharp(buf)
    .rotate()
    .resize({width:2200,height:2200,fit:'inside',withoutEnlargement:true})
    .grayscale()
    .normalize()
    .sharpen()
    .jpeg({quality:82,mozjpeg:true})
    .toBuffer();
}
let paddleWorker=null;
let paddleWorkerBuffer='';
let paddleRequestId=0;
const paddlePending=new Map();
let paddleQueue=Promise.resolve();

function startPaddleWorker(){
  if(paddleWorker&&!paddleWorker.killed)return paddleWorker;
  const python=process.env.PYTHON_BIN||'python3';
  const script=path.join(__dirname,'paddle_ocr_worker.py');
  if(!fs.existsSync(script))return null;
  try{
    paddleWorker=spawn(python,[script],{stdio:['pipe','pipe','pipe']});
    paddleWorkerBuffer='';
    paddleWorker.stdout.on('data',chunk=>{
      paddleWorkerBuffer+=chunk.toString();
      let nl;
      while((nl=paddleWorkerBuffer.indexOf('\n'))>=0){
        const line=paddleWorkerBuffer.slice(0,nl).trim();
        paddleWorkerBuffer=paddleWorkerBuffer.slice(nl+1);
        if(!line)continue;
        try{
          const msg=JSON.parse(line);
          const pending=paddlePending.get(msg.id);
          if(!pending)continue;
          paddlePending.delete(msg.id);
          if(msg.ok)pending.resolve(String(msg.text||''));
          else pending.reject(new Error(msg.error||'PaddleOCR worker failed'));
        }catch(e){console.error('PaddleOCR worker response parse error:',e.message)}
      }
    });
    paddleWorker.stderr.on('data',chunk=>console.log('PaddleOCR:',chunk.toString().trim()));
    const fail=e=>{
      for(const [id,pending] of paddlePending){pending.reject(e);paddlePending.delete(id)}
      paddleWorker=null;
    };
    paddleWorker.on('error',fail);
    paddleWorker.on('exit',(code,signal)=>{
      if(code!==0)console.error('PaddleOCR worker exited:',code,signal||'');
      for(const [id,pending] of paddlePending){pending.reject(new Error('PaddleOCR worker exited'));paddlePending.delete(id)}
      paddleWorker=null;
    });
    return paddleWorker;
  }catch(e){
    console.error('Unable to start PaddleOCR worker:',e.message);
    paddleWorker=null;
    return null;
  }
}

function paddleOcrOnce(buf){
  return new Promise((resolve,reject)=>{
    const worker=startPaddleWorker();
    if(!worker)return reject(new Error('PaddleOCR is not installed or Python is unavailable'));
    const id=++paddleRequestId;
    paddlePending.set(id,{resolve,reject});
    try{
      worker.stdin.write(JSON.stringify({id,image:Buffer.from(buf).toString('base64')})+'\n');
    }catch(e){
      paddlePending.delete(id);
      reject(e);
    }
  });
}

async function paddleOcrImage(buf){
  const run=paddleQueue.then(()=>paddleOcrOnce(buf));
  paddleQueue=run.catch(()=>{});
  return run;
}

async function ocrSpaceOcr(buf,mimeType='image/png'){
  const apiKey=String(process.env.OCR_SPACE_API_KEY||'').trim();
  if(!apiKey)throw new Error('OCR_SPACE_API_KEY is not configured');

  const form=new FormData();
  form.append('file',new Blob([buf],{type:mimeType}),mimeType==='application/pdf'?'bill.pdf':'bill');
  form.append('language',process.env.OCR_SPACE_LANGUAGE||'auto');
  form.append('isTable',String(process.env.OCR_SPACE_TABLE||'true'));
  form.append('OCREngine',String(process.env.OCR_SPACE_ENGINE||'3'));
  form.append('isOverlayRequired','false');

  const response=await fetch('https://api.ocr.space/parse/image',{
    method:'POST',
    headers:{apikey:apiKey},
    body:form
  });
  if(!response.ok)throw new Error('OCR.space HTTP '+response.status);
  const data=await response.json();
  if(data.IsErroredOnProcessing){
    const message=Array.isArray(data.ErrorMessage)?data.ErrorMessage.join('; '):String(data.ErrorMessage||'OCR.space processing failed');
    throw new Error(message);
  }
  const text=Array.isArray(data.ParsedResults)
    ? data.ParsedResults.map(x=>String(x?.ParsedText||'')).filter(Boolean).join('\n')
    : '';
  if(!text.trim())throw new Error('OCR.space returned no text');
  return text;
}

async function ocrImage(buf,mimeType='image/png'){
  const opts={logger:x=>{if(x.status==='recognizing text'&&Math.round((x.progress||0)*100)%20===0)console.log('Tesseract OCR',Math.round((x.progress||0)*100)+'%')}};
  let normalized=null;

  // First try the original image so high-resolution bills retain maximum detail.
  try{
    const apiText=await ocrSpaceOcr(buf,mimeType);
    if(apiText&&apiText.trim().length>=8)return apiText;
  }catch(e){
    console.log('OCR.space original image failed:',e.message);
  }

  // Phone-camera images are often too large for OCR.space. Normalize them to
  // an auto-oriented, high-contrast JPEG and retry automatically.
  try{
    normalized=await normalizeImageForOcr(buf);
    const apiText=await ocrSpaceOcr(normalized,'image/jpeg');
    if(apiText&&apiText.trim().length>=8)return apiText;
  }catch(e){
    console.log('OCR.space normalized image failed:',e.message);
  }

  const source=normalized||buf;
  try{
    const r=await Tesseract.recognize(source,'eng',{...opts,tessedit_pageseg_mode:'4',preserve_interword_spaces:'1'});
    return r.data.text||'';
  }catch(e){
    const r=await Tesseract.recognize(source,'eng',opts);
    return r.data.text||'';
  }
}
async function pdfInfoAndScreenshots(buf){
  const parser=new pdfParse.PDFParse({data:buf});
  try{
    let total=1;
    try{
      const info=await parser.getInfo({parsePageInfo:true});
      total=Math.max(1,Number(info.total)||Number(info.pages?.length)||1);
    }catch(e){console.error('PDF page-count extraction failed:',e.message)}
    const result=await parser.getScreenshot({desiredWidth:1800,imageBuffer:true,imageDataUrl:false});
    const pages=Array.isArray(result?.pages)?result.pages.filter(p=>p?.data).map(p=>Buffer.from(p.data)):[];
    return {total:Math.max(total,pages.length||0),pages};
  }finally{try{await parser.destroy()}catch{}}
}
async function pdfToPng(buf){
  const x=await pdfInfoAndScreenshots(buf);
  if(!x.pages.length)throw new Error('PDF screenshot rendering returned no images');
  return x.pages[0];
}
async function ocrPdfPages(buf){
  const x=await pdfInfoAndScreenshots(buf);
  if(!x.pages.length)return {text:'',pages:0};
  const chunks=[];
  for(let i=0;i<x.pages.length;i++){
    console.log('Purchase OCR page '+(i+1)+'/'+x.pages.length);
    const t=await ocrImage(x.pages[i]);
    if(t.trim())chunks.push('\n[PAGE '+(i+1)+']\n'+t);
  }
  return {text:chunks.join('\n'),pages:x.pages.length};
}
async function extractPdfText(buf){
  // Support both pdf-parse v2 and the older v1 API during upgrades.
  if(pdfParse&&typeof pdfParse.PDFParse==='function'){
    const parser=new pdfParse.PDFParse({data:buf});
    try{
      const result=await parser.getText();
      return result&&result.text?result.text:'';
    }finally{
      try{await parser.destroy()}catch{}
    }
  }
  if(typeof pdfParse==='function'){
    const result=await pdfParse(buf);
    return result&&result.text?result.text:'';
  }
  return '';
}
async function extractText(file){
  if(file.mimetype!=='application/pdf')return ocrImage(file.buffer,file.mimetype);
  try{return await extractPdfText(file.buffer)}catch(e){console.error('PDF text extraction failed:',e.message);return ''}
}
const {parseBill}=require('./purchase-parser');
function mergePurchaseParses(primary,secondary){
  const a=primary||{}, b=secondary||{};
  const items=[];
  const seen=new Set();
  for(const x of [...(a.items||[]),...(b.items||[])]){
    const key=[String(x.name||'').toLowerCase().replace(/[^a-z0-9]+/g,''),Number(x.quantity||0),Number(x.purchase_price||0),String(x.hsn_code||'')].join('|');
    if(!key||seen.has(key))continue;
    seen.add(key);items.push(x);
  }
  return {...a,...b,
    supplier_name:b.supplier_name||a.supplier_name||'',
    supplier_gstin:b.supplier_gstin||a.supplier_gstin||'',
    buyer_name:b.buyer_name||a.buyer_name||'',
    buyer_gstin:b.buyer_gstin||a.buyer_gstin||'',
    buyer_pan:b.buyer_pan||a.buyer_pan||'',
    seller_pan:b.seller_pan||a.seller_pan||'',
    seller_id:b.seller_id||a.seller_id||'',
    buyer_id:b.buyer_id||a.buyer_id||'',
    invoice_number:b.invoice_number||a.invoice_number||'',
    invoice_date:b.invoice_date||a.invoice_date||'',
    place_of_supply:b.place_of_supply||a.place_of_supply||'',
    taxable_total:Number(b.taxable_total||0)||Number(a.taxable_total||0)||0,
    tax_total:Number(b.tax_total||0)||Number(a.tax_total||0)||0,
    cgst:Number(b.cgst||0)||Number(a.cgst||0)||0,
    sgst:Number(b.sgst||0)||Number(a.sgst||0)||0,
    igst:Number(b.igst||0)||Number(a.igst||0)||0,
    invoice_total:Number(b.invoice_total||0)||Number(a.invoice_total||0)||0,
    items
  };
}
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
app.get('/api/purchases',async(r,s)=>s.json({purchases:await db.purchaseBills(r.businessId)})); app.get('/api/purchases/:id',async(r,s)=>s.json({purchase:await db.purchase(r.businessId,Number(r.params.id))}));
app.post('/api/purchases/extract',upload.single('bill'),async(r,s)=>{
  try{
    if(!r.file)return s.status(400).json({error:'Upload a PDF or image'});
    let text=await extractText(r.file);
    let parsed=parseBill(text);

    // Some PDFs contain plenty of readable text but destroy the visual table
    // column order. If that happens, render the PDF page and OCR it before
    // giving up, so a readable invoice does not get rejected just because its
    // table layout was extracted poorly.
    if(r.file.mimetype==='application/pdf'){
      try{
        // Send the original PDF directly to OCR.space. Its table/receipt mode
        // preserves invoice row order much better than first rendering a PDF
        // page into an image and then trying to reconstruct columns.
        console.log('Purchase OCR: sending original PDF to OCR.space Engine '+String(process.env.OCR_SPACE_ENGINE||'3'));
        let ocrText=await ocrSpaceOcr(r.file.buffer,'application/pdf');
        let ocrParsed=parseBill(ocrText);
        // A PDF OCR response can be partial. When it recovers suspiciously few
        // rows, OCR each rendered page separately and keep the result with the
        // most product rows.
        if(ocrParsed.items.length < 10){
          try{
            const pdfScan=await pdfInfoAndScreenshots(r.file.buffer);
            const pageTexts=[];
            for(let i=0;i<pdfScan.pages.length;i++){
              try{
                const pageText=await ocrSpaceOcr(pdfScan.pages[i],'image/png');
                if(pageText&&pageText.trim())pageTexts.push('[PAGE '+(i+1)+']\n'+pageText);
              }catch(e){console.error('Purchase OCR.space page '+(i+1)+' failed:',e.message)}
            }
            const pageOcrText=pageTexts.join('\n\n');
            const pageParsed=parseBill(pageOcrText);
            if(pageParsed.items.length>ocrParsed.items.length)ocrParsed=pageParsed;
            ocrText=ocrText+'\n\n[OCR.SPACE PAGE OCR]\n'+pageOcrText;
          }catch(e){console.error('Purchase page-by-page OCR failed:',e.message)}
        }
        if(ocrParsed.items.length){
          parsed=mergePurchaseParses(parsed,ocrParsed); parsed={...parsed,
            supplier_name:ocrParsed.supplier_name||parsed.supplier_name,
            supplier_gstin:ocrParsed.supplier_gstin||parsed.supplier_gstin,
            buyer_name:ocrParsed.buyer_name||parsed.buyer_name,
            buyer_gstin:ocrParsed.buyer_gstin||parsed.buyer_gstin,
            invoice_number:ocrParsed.invoice_number||parsed.invoice_number,
            invoice_date:ocrParsed.invoice_date||parsed.invoice_date,
            taxable_total:ocrParsed.taxable_total||parsed.taxable_total,
            tax_total:ocrParsed.tax_total||parsed.tax_total,
            cgst:ocrParsed.cgst||parsed.cgst,
            sgst:ocrParsed.sgst||parsed.sgst,
            igst:ocrParsed.igst||parsed.igst,
            invoice_total:ocrParsed.invoice_total||parsed.invoice_total,
            raw_text:text+'\n\n[OCR.SPACE TABLE OCR]\n'+ocrText
          };
          text=parsed.raw_text;
        }
        if(!ocrParsed.items.length){
          console.log('OCR.space returned text but no product rows parsed; trying local rendered-page fallback');
          const pdfScan=await pdfInfoAndScreenshots(r.file.buffer);
          const chunks=[];
          for(let i=0;i<pdfScan.pages.length;i++){
            try{
              const tr=await Tesseract.recognize(pdfScan.pages[i],'eng',{tessedit_pageseg_mode:'6'});
              if(tr.data.text&&tr.data.text.trim())chunks.push('[PAGE '+(i+1)+']\\n'+tr.data.text);
            }catch(e){console.error('Purchase PDF local OCR fallback failed on page '+(i+1)+':',e.message)}
          }
          const fallbackText=chunks.join('\\n\\n');
          const fallbackParsed=parseBill(fallbackText);
          if(fallbackParsed.items.length){
            parsed=mergePurchaseParses(parsed,fallbackParsed); parsed={...parsed,
              supplier_name:fallbackParsed.supplier_name||parsed.supplier_name,
              supplier_gstin:fallbackParsed.supplier_gstin||parsed.supplier_gstin,
              buyer_name:fallbackParsed.buyer_name||parsed.buyer_name,
              buyer_gstin:fallbackParsed.buyer_gstin||parsed.buyer_gstin,
              invoice_number:fallbackParsed.invoice_number||parsed.invoice_number,
              invoice_date:fallbackParsed.invoice_date||parsed.invoice_date,
              taxable_total:fallbackParsed.taxable_total||parsed.taxable_total,
              tax_total:fallbackParsed.tax_total||parsed.tax_total,
              cgst:fallbackParsed.cgst||parsed.cgst,
              sgst:fallbackParsed.sgst||parsed.sgst,
              igst:fallbackParsed.igst||parsed.igst,
              invoice_total:fallbackParsed.invoice_total||parsed.invoice_total,
              raw_text:text+'\\n\\n[OCR.SPACE]\n'+ocrText+'\\n\\n[LOCAL TESSERACT FALLBACK]\n'+fallbackText
            };
            text=parsed.raw_text;
          }
        }
      }catch(e){console.error('OCR.space PDF processing failed; trying local rendered-page OCR:',e.message)}
    }

    // Image invoices need the same multi-pass treatment as PDFs. A single OCR
    // layout can miss rows or the GST footer even when the image is perfectly readable.
    if(r.file.mimetype!=='application/pdf' && parsed.items.length<10){
      try{
        const passes=[];
        let imageScanBuffer=r.file.buffer;
        try{ imageScanBuffer=await normalizeImageForOcr(r.file.buffer); }
        catch(e){ console.log('Image normalization unavailable; using original:',e.message); }
        for(const psm of ['6','11','12']){
          try{
            const tr=await Tesseract.recognize(imageScanBuffer,'eng',{tessedit_pageseg_mode:psm,preserve_interword_spaces:'1'});
            if(tr.data.text&&tr.data.text.trim())passes.push('[TESSERACT PSM '+psm+']\\n'+tr.data.text);
          }catch(e){console.error('Image Tesseract PSM '+psm+' failed:',e.message)}
        }
        const altText=passes.join('\\n\\n');
        const altParsed=parseBill(altText);
        // Every OCR pass can recover different rows. Never discard a pass just
        // because it has the same/lower row count: merge all unique rows.
        if(altParsed.items.length){
          parsed=mergePurchaseParses(parsed,altParsed);
          parsed={...parsed,
            supplier_name:altParsed.supplier_name||parsed.supplier_name,
            supplier_gstin:altParsed.supplier_gstin||parsed.supplier_gstin,
            buyer_name:altParsed.buyer_name||parsed.buyer_name,
            buyer_gstin:altParsed.buyer_gstin||parsed.buyer_gstin,
            invoice_number:altParsed.invoice_number||parsed.invoice_number,
            invoice_date:altParsed.invoice_date||parsed.invoice_date,
            taxable_total:altParsed.taxable_total||parsed.taxable_total,
            tax_total:altParsed.tax_total||parsed.tax_total,
            cgst:altParsed.cgst||parsed.cgst,
            sgst:altParsed.sgst||parsed.sgst,
            igst:altParsed.igst||parsed.igst,
            invoice_total:altParsed.invoice_total||parsed.invoice_total,
            raw_text:text+'\\n\\n[IMAGE MULTI-PASS OCR]\\n'+altText
          };
          text=parsed.raw_text;
        }
      }catch(e){console.error('Image multi-pass OCR failed:',e.message)}
    }

    if(!parsed.items.length)return s.status(422).json({
      error:'The bill could be read, but the product table could not be identified. No stock was changed. Try the original PDF or a clear image of the full bill.'
    });

    const existing=await db.get('SELECT id,status FROM purchase_bills WHERE business_id=? AND file_hash=?',[r.businessId,hash(r.file.buffer)]);
    if(existing){
      if(String(existing.status||'').toUpperCase()==='REVIEW'){
        await db.run('DELETE FROM purchase_bill_items WHERE business_id=? AND purchase_bill_id=?',[r.businessId,existing.id]);
        await db.run('DELETE FROM purchase_bills WHERE business_id=? AND id=?',[r.businessId,existing.id]);
      }else{
        return s.status(409).json({error:'This bill file was already imported',purchase_id:existing.id});
      }
    }

    const id=await db.createPurchase(r.businessId,{
      original_filename:r.file.originalname,
      file_type:r.file.mimetype,
      file_hash:hash(r.file.buffer),
      ...parsed
    });
    for(const x of parsed.items)await db.addPurchaseItem(r.businessId,id,x);
    s.json({success:true,purchase:await db.purchase(r.businessId,id),extracted:parsed});
  }catch(e){
    console.error('Purchase extraction error:',e);
    s.status(400).json({error:e.message});
  }
});
app.post('/api/purchases/:id/confirm',async(r,s)=>{try{s.json({purchase:await db.confirmPurchase(r.businessId,Number(r.params.id),r.body.items||[])})}catch(e){s.status(400).json({error:e.message})}});
app.get('/api/whatsapp/status',async(r,s)=>{try{s.json({status:await db.waStatus(r.businessId)})}catch(e){s.status(500).json({error:e.message})}}); app.post('/api/whatsapp/restart',async(r,s)=>{try{const worker=require('./index');await worker.startBusiness(r.businessId,true);s.json({success:true})}catch(e){s.status(400).json({error:e.message})}});
app.get('/api/settings',async(r,s)=>s.json({business:await db.business(r.businessId)})); app.put('/api/settings',async(r,s)=>s.json({business:await db.updateBusiness(r.businessId,r.body)}));
app.get('/api/orders/:id/voice',async(r,s)=>{const o=await db.order(r.businessId,Number(r.params.id));if(!o)return s.status(404).end();s.json({text:'Order '+o.id+' for '+o.delivered_to+'. '+o.items.map(x=>x.item_name+' '+x.requested_quantity).join(', ')})});
app.use((r,s)=>{if(r.path.startsWith('/api'))return s.status(404).json({error:'API route not found'});s.sendFile(path.join(PUBLIC,'index.html'))});
app.use((e,r,s,n)=>{console.error(e);if(r.path.startsWith('/api'))return s.status(500).json({error:'Server error'});s.status(500).send('Server error')});
db.ready.then(async()=>{app.listen(PORT,'0.0.0.0',()=>console.log('Delivery Management Platform running on '+PORT));try{require('./index').startAll()}catch(e){console.error('WhatsApp worker:',e)}}).catch(e=>{console.error(e);process.exit(1)});
module.exports=app;