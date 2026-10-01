// DeliveryOS Sales & Profit dashboard enhancements.
(function(){
  function setRange(days){
    const to=new Date(), from=new Date(to);
    from.setDate(to.getDate()-days+1);
    const iso=d=>d.toISOString().slice(0,10);
    analyticsFilters.from=iso(from); analyticsFilters.to=iso(to);
    analyticsPage();
  }
  window.setAnalyticsRange=setRange;

  window.exportAnalyticsCsv=async function(){
    try{
      const from=$('anFrom')?.value||analyticsFilters.from;
      const to=$('anTo')?.value||analyticsFilters.to;
      const product=$('anProduct')?.value||analyticsFilters.product;
      const customer=$('anCustomer')?.value||analyticsFilters.customer;
      const source=$('anSource')?.value||analyticsFilters.source;
      const q=new URLSearchParams({from,to,product_id:product,customer,source});
      const d=await api('/api/analytics/sales?'+q.toString());
      const rows=[['Product','Units','Sales','Purchase Value','Gross Profit','Margin %']];
      (d.products||[]).forEach(x=>rows.push([x.name,x.units,x.sales,x.cogs,x.profit,x.margin]));
      const escCsv=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
      const csv=rows.map(r=>r.map(escCsv).join(',')).join('\n');
      const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
      const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
      a.download='deliveryos-sales-profit-'+from+'-to-'+to+'.csv'; a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href),1000);
      toast('Sales & profit CSV exported');
    }catch(e){toast(e.message,true)}
  };

  const originalAnalyticsPage=window.analyticsPage;
  window.analyticsPage=async function(){
    await originalAnalyticsPage();
    const filters=document.querySelector('.analytics-filters');
    if(!filters||document.getElementById('analyticsPresets'))return;
    const presets=document.createElement('div');
    presets.id='analyticsPresets'; presets.className='analytics-presets';
    presets.innerHTML='<span>Quick range:</span>'+
      '<button type="button" onclick="setAnalyticsRange(1)">Today</button>'+
      '<button type="button" onclick="setAnalyticsRange(7)">7 days</button>'+
      '<button type="button" onclick="setAnalyticsRange(30)">30 days</button>'+
      '<button type="button" onclick="setAnalyticsRange(90)">90 days</button>'+
      '<button type="button" onclick="exportAnalyticsCsv()">Export CSV</button>';
    filters.parentNode.insertBefore(presets,filters.nextSibling);
  };

  const originalDashboard=window.dashboard;
  window.dashboard=async function(){
    await originalDashboard();
    try{
      const today=new Date().toISOString().slice(0,10);
      const d=await api('/api/analytics/sales?from='+today+'&to='+today+'&source=ALL');
      const s=d.summary||{};
      const box=document.createElement('section');
      box.className='panel dashboard-profit-card';
      box.innerHTML='<div class="bar"><div><h3>Today’s sales & profit</h3><p class="muted">Delivered orders, after recorded returns.</p></div><button onclick="go(\'analytics\')">Open analysis →</button></div>'+
        '<div class="grid stats analytics-mini-stats">'+
        card('Sales','₹'+n(s.sales),'Net sales')+
        card('Purchase value','₹'+n(s.purchase_value??s.cogs),'Cost of goods sold')+
        card('Profit','₹'+n(s.profit),n(s.margin)+'% margin')+
        card('Units',n(s.units),'Net units sold')+'</div>';
      $('page').appendChild(box);
    }catch(e){}
  };
})();
// No-OCR GST update importer loaded from the existing enhancement bundle.
(function(){
 const template=['GST_UPDATE','EFFECTIVE_FROM: 2027-04-01','','HSN|PRODUCT|OLD_RATE|NEW_RATE','4802|A4 Sheet|18|12','8443|Printer|18|18','','END'].join('\\n');
 window.gstTemplate=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([template],{type:'text/plain'}));a.download='deliveryos-gst-update-template.txt';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
 window.previewGstUpdate=async()=>{try{const d=await api('/api/gst/preview',{method:'POST',body:{text:$('gstUpdateText').value}});$('gstPreview').innerHTML='<div class="tablewrap"><table><thead><tr><th>HSN</th><th>Product</th><th>Current</th><th>New</th><th>Matched</th><th>Status</th></tr></thead><tbody>'+(d.rows||[]).map(x=>'<tr><td>'+esc(x.hsn_code)+'</td><td>'+esc(x.product_name||'-')+'</td><td>'+esc(x.current_rate===null?'Not set':n(x.current_rate)+'%')+'</td><td><b>'+esc(n(x.new_rate)+'%')+'</b></td><td>'+esc(x.product_count)+'</td><td>'+(x.changed?'✅ Change':'ℹ️ No change')+'</td></tr>').join('')+'</tbody></table></div><p class="muted">Effective from: <b>'+esc(d.effective_from)+'</b>. Review before applying.</p>';$('applyGstBtn').disabled=false}catch(e){$('gstPreview').innerHTML='<p class="error">'+esc(e.message)+'</p>';$('applyGstBtn').disabled=true}};
 window.applyGstUpdate=async()=>{if(!confirm('Apply these GST rates to the HSN master and matching products? Existing invoices will not be changed.'))return;try{await api('/api/gst/apply',{method:'POST',body:{text:$('gstUpdateText').value}});toast('GST rates updated successfully');$('applyGstBtn').disabled=true;previewGstUpdate()}catch(e){toast(e.message,true)}};
 window.handleGstFile=e=>{const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=()=>{$('gstUpdateText').value=String(r.result||'');previewGstUpdate()};r.readAsText(f)};
 const oldSettings=window.settingsPage; window.settingsPage=async function(){await oldSettings();const p=document.createElement('section');p.className='panel';p.innerHTML='<div class="bar"><div><h3>GST Rate Updates — no OCR</h3><p class="muted">Upload or paste the fixed DeliveryOS format. No OCR or AI is required.</p></div><button onclick="gstTemplate()">Download template</button></div><label class="wide"><b>Upload TXT/CSV</b><input type="file" accept=".txt,.csv" onchange="handleGstFile(event)"></label><label class="wide"><b>Or paste update</b><textarea id="gstUpdateText" rows="9" placeholder="GST_UPDATE\\nEFFECTIVE_FROM: 2027-04-01\\n\\nHSN|PRODUCT|OLD_RATE|NEW_RATE\\n4802|A4 Sheet|18|12\\n\\nEND"></textarea></label><div class="actions"><button onclick="previewGstUpdate()">Preview changes</button><button id="applyGstBtn" class="primary" disabled onclick="applyGstUpdate()">Apply GST changes</button></div><div id="gstPreview"></div>';$('page').appendChild(p)};
})();
