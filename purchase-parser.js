const NUM='[\\d,]+(?:\\.\\d+)?';

function cleanLines(text){
  return String(text||'').split(/\r?\n/).map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
}
function num(v){return Number(String(v??'').replace(/[₹]|Rs\.?|INR/gi,'').replace(/,/g,'').trim())||0}
function money(v){return Math.round(num(v)*100)/100}
function clean(v){return String(v??'').trim().slice(0,500)}
function findAllGst(text){return [...String(text||'').matchAll(/\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b/gi)].map(x=>x[0].toUpperCase())}
function findPan(text){return (String(text||'').match(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/i)||[])[0]||''}
function makeSku(name,hsn=''){const base=clean(name).toUpperCase().replace(/[^A-Z0-9]+/g,'').slice(0,10)||'ITEM';const h=String(hsn||'').replace(/\D/g,'').slice(0,4);return ('SKU-'+base+(h?'-'+h:'')).slice(0,40)}
function parseNumberLine(line){const s=String(line||'').trim();return /^\d[\d,.]*$/.test(s)?num(s):null}

function parseProductRowText(row,addItem){
  const r=String(row||'').replace(/\s+/g,' ').trim();
  const re=new RegExp('^(\\d+)[.)]?\\s+(.+?)\\s+(\\d{3,8})\\s+('+NUM+')\\s+([A-Za-z]{1,10})\\s+('+NUM+')\\s+('+NUM+')\\s+('+NUM+')\\s+('+NUM+')\\s+('+NUM+')(?=\\s+\\d+[.)]?\\s|\\s+Total\\b|\\s+Total\\s+in\\s+words\\b|$)','i');
  const m=r.match(re); if(!m)return false;
  addItem(m[2],m[3],num(m[4]),m[5],num(m[6]),num(m[7]),num(m[8]),num(m[9]),num(m[10]));
  return true;
}

function parseBill(text){
  const raw=String(text||'');
  const lines=cleanLines(raw);
  const flat=raw.replace(/\r?\n/g,' ').replace(/\s+/g,' ').trim();
  const gstins=findAllGst(raw), pan=findPan(raw);
  const find=(re)=>{for(const l of lines){const m=l.match(re);if(m)return String(m[1]||'').trim()}const m=flat.match(re);return m?String(m[1]||'').trim():''};
  const amountAfter=(re)=>{
    for(let i=0;i<lines.length;i++){
      if(!re.test(lines[i]))continue;
      const same=[...lines[i].matchAll(new RegExp('(?:₹|Rs\\.?|INR)?\\s*('+NUM+')','gi'))].map(m=>num(m[1]));
      if(same.length)return same[same.length-1];
      for(let j=i+1;j<Math.min(lines.length,i+4);j++){
        if(/^\d[\d,.]*$/.test(lines[j])||/^(?:₹|Rs\.?|INR)\s*[\d,]+(?:\.\d+)?$/i.test(lines[j]))return num(lines[j]);
      }
    }
    return 0;
  };
  const invoiceNo=find(/Invoice\s*(?:No|Number)\.?\s*[:\-]?\s*([A-Z0-9\/\-]+)(?=\s|$)/i).replace(/Invoice$/i,'');
  const invoiceDate=find(/Invoice\s*Date\s*[:\-]?\s*([0-9A-Za-z\/\-]+)/i);
  const challanNumber=find(/Challan\s*No\.?\s*[:\-]?\s*([A-Z0-9\/\-]+)/i);
  const challanDate=find(/Challan\s*Date\s*[:\-]?\s*([0-9A-Za-z\/\-]+)/i);
  const eway=find(/E[- ]?Way\s*Bill\s*No\.?\s*[:\-]?\s*([A-Z0-9\/\-]+)/i);
  const transport=find(/^Transport\s+(.+)/i);
  const transportId=find(/Transport\s*ID\s*[:\-]?\s*([A-Z0-9\/\-]+)/i);
  const pos=find(/Place\s*of\s*Supply\s*[:\-]?\s*(.+?)(?=\s+Invoice\s*No|$)/i);
  const invoiceTotal=amountAfter(/(?:Total Amount After Tax|Total Amount)\b/i);
  const taxableTotal=amountAfter(/^Taxable Amount\b/i);
  const taxTotal=amountAfter(/^Total Tax\b/i);
  // GST is often printed in the lower summary section as:
  // CGST 9%  /  amount, SGST 9% / amount, or IGST 18% / amount.
  // OCR may place the percentage and amount on separate lines, so inspect
  // nearby lines instead of requiring the amount to be on the same line.
  const gstSummary=(label)=>{
    const re=new RegExp('\\b'+label+'\\b','i');
    for(let i=0;i<lines.length;i++){
      if(!re.test(lines[i]))continue;
      const window=lines.slice(i,Math.min(lines.length,i+4)).join(' ');
      const nums=[...window.matchAll(/(?:₹|Rs\\.?|INR)?\\s*(\\d[\\d,]*(?:\\.\\d+)?)/gi)].map(m=>num(m[1]));
      const perc=[...window.matchAll(/(\\d+(?:\\.\\d+)?)\\s*%/g)].map(m=>num(m[1]));
      const rate=perc.length?perc[0]:0;
      const amount=nums.length?nums[nums.length-1]:0;
      return {rate,amount};
    }
    return {rate:0,amount:0};
  };
  const ig=gstSummary('IGST');
  const cg=gstSummary('CGST');
  const sg=gstSummary('SGST');
  const igst=ig.amount||amountAfter(/^Add\\s*:\\s*IGST\\b/i);
  const cgst=cg.amount||amountAfter(/^CGST\\s/i);
  const sgst=sg.amount||amountAfter(/^SGST\\s/i);
  const summaryGstRate=ig.rate||((cg.rate||0)+(sg.rate||0));

  const customerIdx=lines.findIndex(l=>/Customer Detail/i.test(l));
  let buyerName=find(/^M\/S\.?\s+(.+)/i);
  if(!buyerName&&customerIdx>=0){
    const mIndex=lines.findIndex((l,idx)=>idx>=customerIdx&&/^M\/S\.?$/i.test(l));
    buyerName=mIndex>=0?(lines[mIndex+1]||''):(lines[customerIdx+1]||'');
  }
  let buyerGstin='';
  if(customerIdx>=0){
    for(let j=customerIdx;j<Math.min(lines.length,customerIdx+30);j++){
      const m=lines[j].match(/\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9])\b/i);
      if(m){buyerGstin=m[1].toUpperCase();break}
    }
  }
  if(!buyerGstin&&gstins.length)buyerGstin=gstins[0];
  const buyerPan=buyerGstin?buyerGstin.slice(2,12):'';

  let sellerName=find(/^For\s+(.+)/i);
  if(!sellerName){
    const candidates=lines.slice(0,Math.max(0,customerIdx));
    sellerName=candidates.find(x=>x&&!/^PAN\b|^TAX INVOICE\b|^ORIGINAL\b/i.test(x)&&!/Customer Detail/i.test(x))||'';
  }
  const sellerGstin=gstins.length>1?gstins[gstins.length-1]:'';
  const sellerPan=pan&&pan!==buyerPan?pan:'';

  const items=[];const seen=new Set();
  const addItem=(name,hsn,q,unit,rate,taxable,gstRate,taxAmount,lineTotal)=>{
    name=clean(name).replace(/^[:\-]+|[:\-]+$/g,'').trim(); hsn=clean(hsn);
    if(!name||!(q>0)||!(rate>0))return;
    if(/^(?:total|taxable amount|tax|invoice|amount|grand total|sr\.?|no\.?|name of product|product|service)$/i.test(name))return;
    if(/(?:^|\s)(?:phone|gstin|invoice no|challan no|e[- ]?way|transport|customer detail)(?:\s|:)/i.test(name))return;
    const key=[name.toLowerCase(),hsn,q,rate].join('|'); if(seen.has(key))return; seen.add(key);
    items.push({name,supplier_sku:'',sku:makeSku(name,hsn),hsn_code:hsn,quantity:q,unit:String(unit||'PCS').toUpperCase(),purchase_price:rate,gst_rate:Number(gstRate||0),taxable_value:taxable||money(q*rate),tax_amount:taxAmount||0,line_total:lineTotal||money((taxable||money(q*rate))+(taxAmount||0))});
  };

  // OCR.space Engine 3 with table mode can return Markdown-style rows.
  // Accept tables with or without the Markdown separator row and tolerate
  // common invoice column names/orderings. OCR is allowed to omit a rate
  // column; when taxable/amount is present we can recover a unit rate safely.
  const markdownLines=lines.filter(l=>l.includes('|'));
  if(markdownLines.length>=2){
    const splitCells=line=>String(line||'').split('|').map(x=>x.trim()).filter((x,i,a)=>!(i===0&&x==='')&&!(i===a.length-1&&x===''));
    const isSeparator=line=>splitCells(line).length>=2&&splitCells(line).every(x=>/^:?-{2,}:?$/.test(x));
    const headerIndex=markdownLines.findIndex(l=>{
      const h=splitCells(l).join(' ').toLowerCase();
      return /product|item|description|particular|goods|service|name/.test(h) && /qty|quantity|units|rate|amount|price|taxable/.test(h);
    });
    if(headerIndex>=0){
      const header=splitCells(markdownLines[headerIndex]).map(x=>x.toLowerCase());
      const dataStart=isSeparator(markdownLines[headerIndex+1])?headerIndex+2:headerIndex+1;
      const col=(patterns)=>{
        for(const p of patterns){const i=header.findIndex(h=>p.test(h));if(i>=0)return i}
        return -1;
      };
      const nameCol=col([/name.*(?:product|item)|product|item|description|particular|goods|service|^name$/]);
      const qtyCol=col([/^qty\.?$|quantity|units?/]);
      const unitCol=col([/^unit$|uom|measure/]);
      const hsnCol=col([/hsn|sac/]);
      const rateCol=col([/^rate$|rate per unit|unit price|price|selling price/]);
      const taxableCol=col([/taxable|base value|net value/]);
      const gstCol=col([/gst|tax %|tax rate|gst %/]);
      const taxCol=col([/^tax$|tax amount|gst amount|igst|cgst|sgst/]);
      const totalCol=col([/^amount$|total|net amount|line total|value/]);
      for(let i=dataStart;i<markdownLines.length;i++){
        if(isSeparator(markdownLines[i]))continue;
        const cells=splitCells(markdownLines[i]);
        if(cells.length<3)continue;
        const get=j=>j>=0&&j<cells.length?cells[j]:'';
        const name=clean(get(nameCol));
        if(!name||/^(?:sr\.?\s*no|total|subtotal|grand total|tax|invoice|amount|description)$/i.test(name))continue;
        const qty=num(get(qtyCol));
        if(!(qty>0))continue;
        const unit=get(unitCol)||'PCS';
        const hsn=clean(get(hsnCol)).replace(/[^0-9]/g,'');
        let rate=money(get(rateCol));
        const taxable=money(get(taxableCol));
        const taxAmount=money(get(taxCol));
        let gstRate=money(get(gstCol));
        let total=money(get(totalCol));
        if(!(rate>0)&&taxable>0)rate=money(taxable/qty);
        if(!(rate>0)&&total>taxAmount)rate=money((total-taxAmount)/qty);
        if(gstRate>100)gstRate=0;
        if(!gstRate&&taxAmount>0&&taxable>0)gstRate=money(taxAmount/taxable*100);
        if(!(total>0))total=money((taxable||qty*rate)+taxAmount);
        if(rate>0)addItem(name,hsn,qty,unit,rate,taxable||money(qty*rate),gstRate,taxAmount,total);
      }
    }
  }

  // Generic OCR row recovery. Camera OCR frequently collapses a table into
  // one line while preserving the serial number, quantity/unit and numeric tail.
  // Recover the row from those stable anchors instead of requiring one exact
  // column layout.
  const looseRowSeen=new Set();
  const parseLooseSerialRow=(line)=>{
    const m=String(line||'').trim().match(/^(\\d{1,3})[.)]?\\s+(.+)$/);
    if(!m)return false;
    const rest=m[2].replace(/\\s+/g,' ').trim();
    if(/^(?:total|subtotal|grand total|taxable amount|total tax|invoice total|amount in words|terms|bank details|customer signature|authori[sz]ed signatory|page\\s+\\d+)/i.test(rest))return false;

    // Locate the first quantity followed by a unit. This is more stable than
    // guessing where the product name ends.
    const qm=rest.match(/(?:^|\\s)(\\d+(?:\\.\\d+)?)\\s*([A-Za-z]{1,12})(?:\\s|$)/);
    if(!qm)return false;
    const q=num(qm[1]); if(!(q>0))return false;
    const qPos=qm.index+(qm[0].indexOf(qm[1]));
    let namePart=rest.slice(0,qPos).trim();
    let tail=rest.slice(qPos+qm[1].length+qm[2].length).trim();
    if(!namePart||!tail)return false;

    // A numeric token immediately before the quantity is usually HSN/SAC.
    let hsn='';
    const hm=namePart.match(/(?:^|\\s)(\\d{4,8})$/);
    if(hm){hsn=hm[1];namePart=namePart.slice(0,hm.index).trim();}
    const name=clean(namePart).replace(/^[-:|]+|[-:|]+$/g,'').trim();
    if(!name||name.length<2||/^(?:sr\\.?\\s*no|product|description|item|name)$/i.test(name))return false;

    const nums=[];
    const percentages=[];
    const tokenRe=/(\\d[\\d,]*(?:\\.\\d+)?|\\d+(?:\\.\\d+)?\\s*%)/g;
    let tm;
    while((tm=tokenRe.exec(tail))){
      const raw=tm[1].trim();
      if(/%$/.test(raw)) percentages.push(num(raw.replace('%','')));
      else nums.push(num(raw));
    }
    if(nums.length<2)return false;

    // The final amount is normally the line total. If taxable value is present,
    // derive unit purchase rate from it; this survives missing/garbled rate cells.
    const total=nums[nums.length-1];
    let taxable=0, rate=0, taxAmount=0;
    if(nums.length>=3){
      taxable=nums[nums.length-2];
      if(taxable>total)taxable=0;
    }
    if(!(taxable>0)&&nums.length>=2)taxable=nums[nums.length-2];
    if(taxable>0)rate=money(taxable/q);
    if(!(rate>0)&&nums.length>=2)rate=nums[0];
    if(!(rate>0))return false;
    if(total>taxable)taxAmount=money(total-taxable);
    let gstRate=percentages.length?percentages[percentages.length-1]:0;
    if(!(gstRate>0)&&taxAmount>0&&taxable>0)gstRate=money(taxAmount/taxable*100);
    const key=[name.toLowerCase(),q,rate,hsn].join('|');
    if(looseRowSeen.has(key))return false;
    looseRowSeen.add(key);
    addItem(name,hsn,q,qm[2],rate,taxable||money(q*rate),gstRate,taxAmount,total);
    return true;
  };

  for(const line of lines)parseLooseSerialRow(line);

  // Product extraction is intentionally based on the flattened table stream.
  // This handles both PDFs that keep rows on separate lines and PDFs that flatten
  // every cell into one line. Comma-formatted money such as 2,535.00 is supported.
  const headerPos=flat.search(/Name\s+of\s+Product\s*\/\s*Service/i);
  const srPos=flat.search(/Sr\.?\s*No\.?/i);
  const tableStart=headerPos>=0?headerPos:(srPos>=0?srPos:-1);
  if(tableStart>=0){
    const tableFlat=flat.slice(tableStart);
    const rowRe=new RegExp('(?:^|\\s)(\\d+)[.)]?\\s+(.+?)\\s+(\\d{3,8})\\s+('+NUM+')\\s+([A-Za-z]{1,10})\\s+('+NUM+')\\s+('+NUM+')\\s+('+NUM+')\\s+('+NUM+')\\s+('+NUM+')(?=\\s+\\d+[.)]?\\s|\\s+Total\\b|\\s+Total\\s+in\\s+words\\b|$)','gi');
    let m;
    while((m=rowRe.exec(tableFlat))){
      addItem(m[2],m[3],num(m[4]),m[5],num(m[6]),num(m[7]),num(m[8]),num(m[9]),num(m[10]));
    }
  }

  // Standard invoice row: Sr No | Product | HSN | Qty Unit | Rate | Taxable | GST | Total.
  const standardRowRe=new RegExp('^(\\d{1,4})[.)]?\\s+(.+?)\\s+(\\d{3,8})\\s+('+NUM+')\\s*([A-Za-z]{1,10})\\s+('+NUM+')\\s+('+NUM+')\\s+('+NUM+')\\s+('+NUM+')$','i');
  for(const line of lines){
    const m=line.match(standardRowRe);
    if(!m)continue;
    const name=String(m[2]||'').trim();
    if(!name||/^(?:total|subtotal|grand total|taxable amount|invoice total|sr\\.?\\s*no|product|description)$/i.test(name))continue;
    const hsn=m[3], qty=num(m[4]), unit=m[5]||'PCS', rate=num(m[6]), taxable=num(m[7]), gstRate=num(m[8]), total=num(m[9]);
    if(qty>0&&rate>0){
      const actualTaxable=taxable>0?taxable:money(qty*rate);
      const taxAmount=total>actualTaxable?money(total-actualTaxable):0;
      addItem(name,hsn,qty,unit,rate,actualTaxable,gstRate,taxAmount,total||money(actualTaxable+taxAmount));
    }
  }

  const retailRowRe=new RegExp('^(\\d+)\\s+(.+?)\\s+(?:(\\d{3,8}|[-—–])\\s+)?('+NUM+')\\s*([A-Za-z]{1,10})\\s+('+NUM+')\\s+('+NUM+')\\s+('+NUM+')\\s*(?:\\(([0-9]+(?:\\.[0-9]+)?)\\))?\\s+('+NUM+')$','i');
  for(const line of lines){
    const m=line.match(retailRowRe);
    if(!m)continue;
    let name=String(m[2]||'').trim();
    // Tesseract can leave a tiny artifact immediately before a real capitalized product name.
    name=name.replace(/^(?:[a-z]{1,3}\s+)+(?=[A-Z])/,'').trim();
    const hsn=(m[3]&&/^\d+$/.test(m[3]))?m[3]:'';
    const qty=num(m[4]), unit=m[5], mrp=num(m[6]), rate=num(m[7]), taxAmount=num(m[8]), gstFromText=m[9]?num(m[9]):0, total=num(m[10]);
    const taxable=money(qty*rate);
    const gst=gstFromText||((taxable>0&&taxAmount>0)?money(taxAmount/taxable*100):0);
    addItem(name,hsn,qty,unit,rate,taxable,gst,taxAmount,total);
  }


  // OCR often breaks one product row across several physical lines. Rebuild
  // rows beginning with a serial number before applying the column parsers.
  const rebuiltRows=[];
  let pending='';
  for(const line of lines){
    if(/^\d{1,4}[.)]?\s*$/.test(line)){
      if(pending)rebuiltRows.push(pending);
      pending=line;
    }else if(pending && !/^(?:total|subtotal|taxable amount|total tax|grand total|invoice total|amount in words|terms|bank details|customer signature|authori[sz]ed signatory|page\s+\d+)/i.test(line)){
      pending+=' '+line;
    }else if(pending){
      rebuiltRows.push(pending); pending='';
    }
  }
  if(pending)rebuiltRows.push(pending);

  for(const row of rebuiltRows){
    if(parseProductRowText(row,addItem))continue;
    const rr=retailRowRe.exec(row);
    if(rr){
      const name=String(rr[2]||'').trim();
      const hsn=(rr[3]&&/^\d+$/.test(rr[3]))?rr[3]:'';
      const qty=num(rr[4]), unit=rr[5], rate=num(rr[7]), taxAmount=num(rr[8]), gstRate=rr[9]?num(rr[9]):0, total=num(rr[10]);
      const taxable=money(qty*rate);
      const gst=gstRate||((taxable>0&&taxAmount>0)?money(taxAmount/taxable*100):0);
      addItem(name,hsn,qty,unit,rate,taxable,gst,taxAmount,total);
      continue;
    }
    const rm=new RegExp('^(\\d+)[.)]?\\s+(.+?)\\s+(?:(\\d{3,8})\\s+)?('+NUM+')\\s*([A-Za-z]{1,10})\\s+('+NUM+')\\s+('+NUM+')\\s+(?:(('+NUM+')\\s*)?(?:\\(([0-9]+(?:\\.[0-9]+)?)\\))?\\s+)?('+NUM+')$','i').exec(row);
    if(!rm)continue;
    const name=String(rm[2]||'').trim();
    const hsn=(rm[3]&&/^\d+$/.test(rm[3]))?rm[3]:'';
    const qty=num(rm[4]), unit=rm[5], n1=num(rm[6]), n2=num(rm[7]), tax=num(rm[8]), gst=rm[9]?num(rm[9]):0, total=num(rm[10]);
    // Four numeric values after quantity are interpreted as MRP, rate, tax, total.
    // Five numeric values are interpreted as rate, taxable, GST, tax, total.
    if(rm[10]){
      const rate=(gst>0||tax>0)&&n2>0?n2:n1;
      const taxable=money(qty*rate);
      const gstRate=gst||((taxable>0&&tax>0)?money(tax/taxable*100):0);
      addItem(name,hsn,qty,unit,rate,taxable,gstRate,tax,total);
    }
  }

  // Last-resort OCR row parser. OCR can flatten or shift table columns, so use
  // serial + quantity/unit + numeric-tail anchors instead of one exact layout.
  for(const line of lines){
    const head=line.match(/^(\\d{1,4})[.)]?\\s+(.+?)\\s+(?:(\\d{3,8})\\s+)?(\\d+(?:[.,]\\d+)?)\\s*([A-Za-z]{1,10})\\s+(.+)$/);
    if(!head)continue;
    const name=String(head[2]||'').trim();
    if(!name||/^(?:total|subtotal|taxable amount|grand total|invoice|amount|sr|no|product|service)$/i.test(name))continue;
    const hsn=(head[3]&&/^\\d+$/.test(head[3]))?head[3]:'';
    const qty=num(head[4]), unit=String(head[5]||'PCS').toUpperCase();
    const tail=String(head[6]||'');
    const nums=[]; const reNum=/(?:₹|Rs\\.?|INR)?\\s*(\\d[\\d,]*(?:\\.\\d+)?)/gi;
    let nm;
    while((nm=reNum.exec(tail)))nums.push(num(nm[1]));
    if(nums.length<3||!(qty>0))continue;

    let rate=0,taxable=0,gstRate=0,taxAmount=0,total=0;
    const paren=(tail.match(/\\(([0-9]+(?:\\.[0-9]+)?)\\)/)||[])[1];
    if(nums.length>=5){
      rate=nums[nums.length-5]; taxable=nums[nums.length-4];
      gstRate=paren?num(paren):nums[nums.length-3];
      taxAmount=nums[nums.length-2]; total=nums[nums.length-1];
    }else if(nums.length===4){
      rate=nums[0]; taxable=nums[1]; taxAmount=nums[2]; total=nums[3];
      gstRate=paren?num(paren):((taxable>0&&taxAmount>0)?money(taxAmount/taxable*100):0);
    }else{
      rate=nums[0]; taxAmount=nums[nums.length-2]; total=nums[nums.length-1];
      taxable=money(qty*rate);
      gstRate=paren?num(paren):((taxable>0&&taxAmount>0)?money(taxAmount/taxable*100):0);
    }
    if(rate>0&&total>0)addItem(name,hsn,qty,unit,rate,taxable,gstRate,taxAmount,total);
  }

  const itemTaxableTotal=money(items.reduce((s,x)=>s+Number(x.taxable_value||0),0));
  const itemTaxTotal=money(items.reduce((s,x)=>s+Number(x.tax_amount||0),0));
  const itemInvoiceTotal=money(items.reduce((s,x)=>s+Number(x.line_total||0),0));
  const finalTaxableTotal=taxableTotal||itemTaxableTotal;
  const summaryTaxTotal=money(cgst+sgst+igst);
  const finalTaxTotal=taxTotal||summaryTaxTotal||itemTaxTotal||((invoiceTotal||itemInvoiceTotal)>finalTaxableTotal?money((invoiceTotal||itemInvoiceTotal)-finalTaxableTotal):0);
  const finalInvoiceTotal=invoiceTotal||itemInvoiceTotal;
  // If the bill gives GST only in the summary, carry that written GST rate
  // onto items that do not already have a reliable line-level GST rate.
  if(summaryGstRate>0){
    for(const item of items)if(!(Number(item.gst_rate)>0))item.gst_rate=summaryGstRate;
  }
  return {supplier_name:sellerName,supplier_gstin:sellerGstin,supplier_address:'',buyer_name:buyerName,buyer_gstin:buyerGstin,buyer_pan:buyerPan,seller_pan:sellerPan,seller_phone:'',seller_address:'',seller_state:'',seller_state_code:'',seller_id:sellerPan||sellerGstin||sellerName,buyer_id:buyerGstin||buyerPan||buyerName,invoice_number:invoiceNo,invoice_date:invoiceDate,place_of_supply:pos,challan_number:challanNumber,challan_date:challanDate,eway_bill_number:eway,transport,transport_id:transportId,taxable_total:finalTaxableTotal,tax_total:finalTaxTotal,cgst,sgst,igst,invoice_total:finalInvoiceTotal,items,raw_text:raw};
}
module.exports={parseBill};
