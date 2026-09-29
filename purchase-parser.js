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
  const invoiceTotal=amountAfter(/Total Amount After Tax/i);
  const taxableTotal=amountAfter(/^Taxable Amount\b/i);
  const taxTotal=amountAfter(/^Total Tax\b/i);
  const igst=amountAfter(/^Add\s*:\s*IGST\b/i);
  const cgst=amountAfter(/^CGST\s/i), sgst=amountAfter(/^SGST\s/i);

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
    if(!name||!hsn||!(q>0)||!(rate>0))return;
    if(/^(?:total|taxable amount|tax|invoice|amount|grand total|sr\.?|no\.?|name of product|product|service)$/i.test(name))return;
    if(/(?:^|\s)(?:phone|gstin|invoice no|challan no|e[- ]?way|transport|customer detail)(?:\s|:)/i.test(name))return;
    const key=[name.toLowerCase(),hsn,q,rate].join('|'); if(seen.has(key))return; seen.add(key);
    items.push({name,supplier_sku:'',sku:makeSku(name,hsn),hsn_code:hsn,quantity:q,unit:String(unit||'PCS').toUpperCase(),purchase_price:rate,gst_rate:Number(gstRate||0),taxable_value:taxable||money(q*rate),tax_amount:taxAmount||0,line_total:lineTotal||money((taxable||money(q*rate))+(taxAmount||0))});
  };

  const headerIndex=lines.findIndex(l=>/Name\s+of\s+Product\s*\/\s*Service/i.test(l));
  let tableLines=headerIndex>=0?lines.slice(headerIndex+1):[];
  if(headerIndex<0){const sr=lines.findIndex(l=>/^Sr\.?$/.test(l));if(sr>=0)tableLines=lines.slice(sr+1)}

  for(let i=0;i<tableLines.length;i++){
    const line=tableLines[i];
    if(/^Total\b/i.test(line)||/^Total\s+in\s+words/i.test(line))break;
    if(parseProductRowText(line,addItem))continue;

    if(/^\d+[.)]?$/.test(line)){
      let j=i+1; const nameParts=[];
      while(j<tableLines.length && !/^\d{3,8}$/.test(tableLines[j]) && !/^Total\b/i.test(tableLines[j])){
        nameParts.push(tableLines[j]);j++;
      }
      if(j<tableLines.length && /^\d{3,8}$/.test(tableLines[j])){
        const hsn=tableLines[j++];
        if(j<tableLines.length){
          const qm=tableLines[j].match(new RegExp('^('+NUM+')\\s+([A-Za-z]{1,10})$'));
          if(qm){
            const q=num(qm[1]),unit=qm[2];j++;
            const nums=[];
            while(j<tableLines.length&&nums.length<5){
              const tokens=tableLines[j].split(/\s+/).filter(Boolean);
              if(!tokens.length||/^Total\b/i.test(tableLines[j]))break;
              let consumed=true;
              for(const t of tokens){if(parseNumberLine(t)!==null)nums.push(num(t));else{consumed=false;break}}
              if(!consumed)break;
              j++;
            }
            if(nums.length>=5){
              addItem(nameParts.join(' '),hsn,q,unit,nums[0],nums[1],nums[2],nums[3],nums[4]);
              i=j-1;continue;
            }
          }
        }
      }
    }
  }

  if(!items.length&&headerIndex>=0){
    const tableFlat=lines.slice(headerIndex+1).join(' ').replace(/\s+/g,' ').trim();
    const rowRe=new RegExp('(?:^|\\s)(\\d+)[.)]?\\s+(.+?)\\s+(\\d{3,8})\\s+('+NUM+')\\s+([A-Za-z]{1,10})\\s+('+NUM+')\\s+('+NUM+')\\s+('+NUM+')\\s+('+NUM+')\\s+('+NUM+')(?=\\s+\\d+[.)]?\\s|\\s+Total\\b|\\s+Total\\s+in\\s+words\\b|$)','gi');
    let m;while((m=rowRe.exec(tableFlat)))addItem(m[2],m[3],num(m[4]),m[5],num(m[6]),num(m[7]),num(m[8]),num(m[9]),num(m[10]));
  }

  return {supplier_name:sellerName,supplier_gstin:sellerGstin,supplier_address:'',buyer_name:buyerName,buyer_gstin:buyerGstin,buyer_pan:buyerPan,seller_pan:sellerPan,seller_phone:'',seller_address:'',seller_state:'',seller_state_code:'',seller_id:sellerGstin||sellerPan||sellerName,buyer_id:buyerGstin||buyerPan||buyerName,invoice_number:invoiceNo,invoice_date:invoiceDate,place_of_supply:pos,challan_number:challanNumber,challan_date:challanDate,eway_bill_number:eway,transport,transport_id:transportId,taxable_total:taxableTotal,tax_total:taxTotal,cgst,sgst,igst,invoice_total:invoiceTotal,items,raw_text:raw};
}
module.exports={parseBill};
