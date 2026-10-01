// DeliveryOS no-OCR GST update importer.
(function(){
  const template=[
    'GST_UPDATE',
    'EFFECTIVE_FROM: 2027-04-01',
    '',
    'HSN|PRODUCT|OLD_RATE|NEW_RATE',
    '4802|A4 Sheet|18|12',
    '8443|Printer|18|18',
    '',
    'END'
  ].join('\n');

  window.gstTemplate=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([template],{type:'text/plain'}));a.download='deliveryos-gst-update-template.txt';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
  window.previewGstUpdate=async()=>{
    try{
      const text=$('gstUpdateText').value;
      const d=await api('/api/gst/preview',{method:'POST',body:{text}});
      const rows=d.rows||[];
      $('gstPreview').innerHTML='<div class="tablewrap"><table><thead><tr><th>HSN</th><th>Product</th><th>Current</th><th>New</th><th>Products matched</th><th>Status</th></tr></thead><tbody>'+
        rows.map(x=>'<tr><td>'+esc(x.hsn_code)+'</td><td>'+esc(x.product_name||'-')+'</td><td>'+esc(x.current_rate===null?'Not set':n(x.current_rate)+'%')+'</td><td><b>'+esc(n(x.new_rate)+'%')+'</b></td><td>'+esc(x.product_count)+'</td><td>'+ (x.changed?'✅ Change':'ℹ️ No change')+'</td></tr>').join('')+
        '</tbody></table></div><p class="muted">Effective from: <b>'+esc(d.effective_from)+'</b>. Review before applying.</p>';
      $('applyGstBtn').disabled=false;
    }catch(e){$('gstPreview').innerHTML='<p class="error">'+esc(e.message)+'</p>';$('applyGstBtn').disabled=true}
  };
  window.applyGstUpdate=async()=>{
    if(!confirm('Apply these GST rates to the HSN master and all products with matching HSN codes? Existing invoices will not be changed.'))return;
    try{await api('/api/gst/apply',{method:'POST',body:{text:$('gstUpdateText').value}});toast('GST rates updated successfully');$('applyGstBtn').disabled=true;previewGstUpdate()}catch(e){toast(e.message,true)}
  };
  window.handleGstFile=e=>{
    const f=e.target.files?.[0];if(!f)return;
    const r=new FileReader();r.onload=()=>{$('gstUpdateText').value=String(r.result||'');previewGstUpdate()};r.readAsText(f);
  };
  const originalSettings=window.settingsPage;
  window.settingsPage=async function(){
    await originalSettings();
    const panel=document.createElement('section');panel.className='panel';
    panel.innerHTML='<div class="bar"><div><h3>GST Rate Updates — no OCR</h3><p class="muted">Use the DeliveryOS text/CSV-style format. It reads HSN and new GST rates directly.</p></div><button onclick="gstTemplate()">Download template</button></div>'+
      '<label class="wide"><b>Upload TXT/CSV</b><input type="file" accept=".txt,.csv" onchange="handleGstFile(event)"></label>'+
      '<label class="wide"><b>Or paste the update</b><textarea id="gstUpdateText" rows="9" placeholder="GST_UPDATE\nEFFECTIVE_FROM: 2027-04-01\n\nHSN|PRODUCT|OLD_RATE|NEW_RATE\n4802|A4 Sheet|18|12\n\nEND"></textarea></label>'+
      '<div class="actions"><button onclick="previewGstUpdate()">Preview changes</button><button id="applyGstBtn" class="primary" disabled onclick="applyGstUpdate()">Apply GST changes</button></div><div id="gstPreview"></div>';
    $('page').appendChild(panel);
  };
})();