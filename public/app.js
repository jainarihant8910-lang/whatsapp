const $=id=>document.getElementById(id); let csrf=localStorage.getItem('dm_csrf')||''; let business=null; let page='dashboard'; let items=[],customers=[],orders=[],invoices=[]; let waTimer=null;
const esc=x=>String(x??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); const n=x=>Number(x||0).toLocaleString('en-IN',{maximumFractionDigits:2});
async function api(url,opt={}){opt.headers={...(opt.headers||{})};if(!(opt.body instanceof FormData))opt.headers['Content-Type']='application/json';if(opt.method&&opt.method!=='GET')opt.headers['x-csrf-token']=csrf;if(opt.body&&!(opt.body instanceof FormData))opt.body=JSON.stringify(opt.body);const r=await fetch(url,{...opt,credentials:'same-origin'});let d={};try{d=await r.json()}catch{}if(r.status===401){showLogin();throw Error('Login required')}if(!r.ok)throw Error(d.error||'Request failed');return d}
function toast(m,bad=false){const x=document.createElement('div');x.className='toast '+(bad?'bad':'');x.textContent=m;$('toast').appendChild(x);setTimeout(()=>x.remove(),3500)}
function showLogin(){ $('appView').classList.add('hidden');$('loginView').classList.remove('hidden') } function showApp(){ $('loginView').classList.add('hidden');$('appView').classList.remove('hidden');$('firmLabel').textContent=business?.firm_id||'' }
$('loginTab').onclick=()=>{$('loginTab').classList.add('active');$('registerTab').classList.remove('active');$('loginForm').classList.remove('hidden');$('registerForm').classList.add('hidden')}; $('registerTab').onclick=()=>{$('registerTab').classList.add('active');$('loginTab').classList.remove('active');$('registerForm').classList.remove('hidden');$('loginForm').classList.add('hidden')};
$('loginForm').onsubmit=async e=>{e.preventDefault();try{const d=await api('/api/auth/login',{method:'POST',body:{firm_id:$('loginFirm').value,password:$('loginPass').value}});csrf=d.csrf;business=d.business;localStorage.setItem('dm_csrf',csrf);showApp();go('dashboard')}catch(x){$('authMsg').textContent=x.message}};
$('registerForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/auth/register',{method:'POST',body:{firm_id:$('regFirm').value,name:$('regName').value,password:$('regPass').value}});toast('Business created. Sign in now.');$('loginTab').click();$('loginFirm').value=$('regFirm').value}catch(x){$('authMsg').textContent=x.message}};
$('logout').onclick=async()=>{try{await api('/api/auth/logout',{method:'POST'})}catch{}localStorage.removeItem('dm_csrf');showLogin()}; $('refresh').onclick=()=>load(); $('menu').onclick=()=>document.body.classList.toggle('open');
document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>go(b.dataset.page)); $('closeModal').onclick=()=>$('modal').classList.add('hidden');
async function go(p){page=p;document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('active',x.dataset.page===p));$('title').textContent=p[0].toUpperCase()+p.slice(1);$('subtitle').textContent=p==='dashboard'?'Business overview':'Manage '+p;document.body.classList.remove('open');await load()}
async function load(){try{if(page==='dashboard')return dashboard();if(page==='orders')return ordersPage();if(page==='products')return productsPage();if(page==='customers')return customersPage();if(page==='senders')return sendersPage();if(page==='invoices')return invoicesPage();if(page==='purchases')return purchasesPage();if(page==='transactions')return transactionsPage();if(page==='whatsapp')return whatsappPage();if(page==='settings')return settingsPage()}catch(e){toast(e.message,true)}}
function card(title,value,sub){return `<div class='card'><small>${esc(title)}</small><strong>${esc(value)}</strong><span>${esc(sub||'')}</span></div>`}
async function dashboard(){const d=await api('/api/dashboard');const p=await api('/api/items');items=p.items||[];$('page').innerHTML=`<div class='grid stats'>${card('Today orders',d.todayOrders,'WhatsApp + manual')}${card('All orders',d.orders,'Recorded deliveries')}${card('Products',d.products,'Inventory master')}${card('Low stock',d.lowStock,'Needs attention')}${card('Pending orders',d.pending,'Confirmation pending')}${card('Invoices',d.invoices,'Draft + finalized')}${card('Purchase bills',d.purchases,'Uploaded bills')}${card('Stock value','₹'+n(d.stockValue),'At purchase price')}</div><div class='grid two'><section class='panel'><h3>Quick actions</h3><div class='actions'><button class='primary' onclick="openProduct()">+ Product</button><button onclick="openCustomer()">+ Customer</button><button onclick="openInvoice()">+ Invoice</button><button onclick="go('purchases')">📥 Purchase bill</button></div></section><section class='panel'><h3>Low stock</h3>${items.filter(x=>x.low_stock).slice(0,8).map(x=>`<div class='row'><span>${esc(x.name)}</span><b>${n(x.current_stock)} / min ${n(x.minimum_stock)}</b></div>`).join('')||'<div class="muted">No low-stock products.</div>'}</section></div>`}
async function productsPage(){const d=await api('/api/items');items=d.items||[];$('page').innerHTML=`<div class='bar'><div><h3>Products & stock</h3><p class='muted'>Selling price, GST, HSN and inventory.</p></div><button class='primary' onclick="openProduct()">+ Add product</button></div><div class='panel tablewrap'><table><thead><tr><th>Product</th><th>SKU</th><th>HSN</th><th>Stock</th><th>Buy</th><th>Sell</th><th>GST</th><th></th></tr></thead><tbody>${items.map(x=>`<tr><td><b>${esc(x.name)}</b><small>${esc(x.unit)}</small></td><td>${esc(x.sku)}</td><td>${esc(x.hsn_code)}</td><td>${n(x.current_stock)} ${x.low_stock?'⚠️':''}</td><td>₹${n(x.purchase_price)}</td><td>₹${n(x.selling_price)}</td><td>${n(x.gst_rate)}%</td><td><button onclick='stockIn(${x.id})'>+ Stock</button>${Number(x.current_stock)===0?`<button class='danger' onclick='deleteProduct(${x.id},${JSON.stringify(x.name)})'>Delete</button>`:''}</td></tr>`).join('')}</tbody></table></div>`}
function openProduct(){modal('Add product',`<form id='productForm' class='formgrid'><label>Name<input name='name' required></label><label>SKU<input name='sku'></label><label>HSN/SAC<input name='hsn_code'></label><label>Unit<input name='unit' value='PCS'></label><label>Opening stock<input name='opening_stock' type='number' min='0' value='0'></label><label>Minimum stock<input name='minimum_stock' type='number' min='0' value='0'></label><label>Purchase price<input name='purchase_price' type='number' min='0' step='0.01'></label><label>Selling price<input name='selling_price' type='number' min='0' step='0.01'></label><label>GST %<input name='gst_rate' type='number' min='0' step='0.01'></label><button class='primary'>Save product</button></form>`);$('productForm').onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));await api('/api/items',{method:'POST',body:d});$('modal').classList.add('hidden');toast('Product saved');productsPage()}}
async function stockIn(id){const q=prompt('Quantity to add');if(q===null)return;try{await api('/api/items/'+id+'/stock',{method:'POST',body:{quantity:Number(q),reason:'Manual stock addition'}});toast('Stock added');productsPage()}catch(e){toast(e.message,true)}}
async function deleteProduct(id,name){if(!confirm('Delete "'+name+'" from Products? This is allowed only when stock is zero. Historical orders and stock history are kept.'))return;try{await api('/api/items/'+id,{method:'DELETE'});toast('Product deleted');productsPage()}catch(e){toast(e.message,true)}}
async function ordersPage(){
  const d=await api('/api/orders');orders=d.orders||[];
  $('page').innerHTML=`<div class='bar'><div><h3>Orders</h3><p class='muted'>One row per WhatsApp message. Returns automatically add stock back.</p></div><button onclick="openReturnPicker()">↩ Quick return</button><button onclick="go('transactions')">Stock history</button></div>
  <div class='panel tablewrap'><table><thead><tr><th>Order</th><th>Date</th><th>Delivered to</th><th>Item names</th><th>Qty</th><th>Returned</th><th>Remaining</th><th>Status</th><th>Actions</th></tr></thead><tbody>${orders.map(o=>`<tr><td>#${o.id}</td><td>${esc(o.date)} ${esc(o.time)}</td><td>${esc(o.delivered_to)}</td><td>${esc(o.item_names||o.items||'View order')}</td><td>${n(o.accepted_items)}</td><td>${n(o.returned_items||0)}</td><td>${n(Math.max(0,Number(o.accepted_items||0)-Number(o.returned_items||0)))} </td><td><span class='badge ${String(o.status).toLowerCase()}'>${esc(o.status)}</span></td><td><button onclick="voice(${o.id})">🔊 Voice</button><button onclick="pdf('/api/orders/${o.id}/invoice-pdf')">🧾 Invoice PDF</button>${['SUCCESS','PARTIAL','PARTIAL_RETURN'].includes(o.status)?`<button onclick="openReturn(${o.id})">↩ Return</button>`:''}</td></tr>`).join('')}</tbody></table></div>`;
}
async function openReturnPicker(){
  try{
    const d=await api('/api/orders');
    const list=(d.orders||[]).filter(o=>['SUCCESS','PARTIAL','PARTIAL_RETURN'].includes(o.status));
    const options=list.map(o=>'<option value="'+o.id+'">#'+o.id+' — '+esc(o.delivered_to)+' — '+esc(o.date)+' — '+esc(o.status)+'</option>').join('');
    modal('Quick return portal',
      '<p class="muted">Select a delivered order. You can return all or only part of any accepted item. Returned quantity is added back to stock and the server prevents returning more than the remaining delivered quantity.</p>'+
      '<label>Order<select id="returnOrderPick">'+(options||'<option value="">No delivered orders available</option>')+'</select></label>'+
      '<button id="openPickedReturn" class="primary">Continue</button>');
    $('openPickedReturn').onclick=()=>{
      const id=Number($('returnOrderPick').value);
      if(id)openReturn(id);else toast('No delivered orders available.',true);
    };
  }catch(e){toast(e.message,true)}
}

async function openReturn(id){
  try{
    const d=await api('/api/orders/'+id);const o=d.order;
    const rows=(o.items||[]).filter(x=>Number(x.remaining_quantity)>0);
    modal('Quick return — Order #'+id,`<p class='muted'>Return only the remaining delivered quantity. After processing, the remaining quantity and invoice PDF are updated immediately.</p>
      <div class='tablewrap'><table><thead><tr><th>Product</th><th>Delivered</th><th>Already returned</th><th>Remaining</th><th>Return now</th></tr></thead><tbody>
      ${rows.map(x=>`<tr><td>${esc(x.item_name)}</td><td>${n(x.accepted_quantity)} ${esc(x.unit)}</td><td>${n(x.returned_quantity)} ${esc(x.unit)}</td><td><b>${n(x.remaining_quantity)} ${esc(x.unit)}</b></td><td><input class='returnQty' data-item='${x.id}' type='number' min='0' max='${x.remaining_quantity}' step='0.01' value='0'></td></tr>`).join('')}
      </tbody></table></div>
      <small class='muted'>Only returned quantities are added back to stock. The invoice PDF uses the remaining quantity.</small>
      <label>Reason<input id='returnReason' placeholder='Customer return / damaged / wrong item'></label>
      <button id='saveReturn' class='primary'>Process return & update invoice</button>`);
    $('saveReturn').onclick=async()=>{
      const items=[...document.querySelectorAll('.returnQty')].map(x=>({order_item_id:Number(x.dataset.item),quantity:Number(x.value)})).filter(x=>x.quantity>0);
      if(!items.length){toast('Enter a return quantity.',true);return}
      await api('/api/orders/'+id+'/returns',{method:'POST',body:{items,reason:$('returnReason').value}});
      $('modal').classList.add('hidden');toast('Return processed. Remaining quantity and invoice updated.');ordersPage();
    };
  }catch(e){toast(e.message,true)}
}
async function voice(id){const d=await api('/api/orders/'+id+'/voice');if('speechSynthesis'in window){speechSynthesis.cancel();speechSynthesis.speak(new SpeechSynthesisUtterance(d.text))}} function pdf(u){window.open(u,'_blank')}
async function customersPage(){const d=await api('/api/customers');customers=d.customers||[];$('page').innerHTML=`<div class='bar'><h3>Customers</h3><button class='primary' onclick='openCustomer()'>+ Customer</button></div><div class='panel tablewrap'><table><thead><tr><th>Name</th><th>Phone</th><th>GSTIN</th><th>State</th><th>Address</th></tr></thead><tbody>${customers.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.phone)}</td><td>${esc(x.gstin)}</td><td>${esc(x.state)} ${esc(x.state_code)}</td><td>${esc(x.address)}</td></tr>`).join('')}</tbody></table></div>`}
async function sendersPage(){const d=await api('/api/senders');const list=d.senders||[];$('page').innerHTML=`<div class='bar'><div><h3>Allowed WhatsApp Numbers</h3><p class='muted'>Only these personal WhatsApp numbers can create orders. Groups and all other numbers are ignored.</p></div><button class='primary' onclick='openSender()'>+ Add number</button></div><div class='panel tablewrap'><table><thead><tr><th>Sender name</th><th>Allowed WhatsApp number</th><th>Actions</th></tr></thead><tbody>${list.map(x=>`<tr><td><b>${esc(x.name)}</b></td><td>${esc(x.whatsapp_id)}</td><td><button onclick='openSender(${x.id},${JSON.stringify(x.name)},${JSON.stringify(x.whatsapp_id)})'>Edit</button><button onclick='removeSender(${x.id})'>Remove</button></td></tr>`).join('')||'<tr><td colspan="3" class="muted">No allowed numbers yet.</td></tr>'}</tbody></table></div>`}
function openSender(id='',name='',phone=''){modal(id?'Edit allowed number':'Add allowed number',`<form id='senderForm' class='formgrid'><label>Sender name<input name='name' value='${esc(name)}' required></label><label>WhatsApp number<input name='phone' value='${esc(phone)}' placeholder='919876543210' required></label><small class='wide'>Enter the real WhatsApp phone number, including country code. Do not enter an @lid ID. Example: +91 9876543210</small><button class='primary'>${id?'Save changes':'Add number'}</button></form>`);$('senderForm').onsubmit=async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.target));try{await api(id?'/api/senders/'+id:'/api/senders',{method:id?'PUT':'POST',body});$('modal').classList.add('hidden');toast(id?'Allowed number updated':'Allowed number added');sendersPage()}catch(x){toast(x.message,true)}}}
async function removeSender(id){if(!confirm('Remove this number from the allowed list? It will no longer be able to create orders.'))return;try{await api('/api/senders/'+id,{method:'DELETE'});toast('Allowed number removed');sendersPage()}catch(e){toast(e.message,true)}}
function openCustomer(){modal('Add customer',`<form id='customerForm' class='formgrid'><label>Name<input name='name' required></label><label>Phone<input name='phone'></label><label>GSTIN<input name='gstin'></label><label>Email<input name='email'></label><label>State<input name='state'></label><label>State code<input name='state_code'></label><label class='wide'>Address<textarea name='address'></textarea></label><button class='primary'>Save customer</button></form>`);$('customerForm').onsubmit=async e=>{e.preventDefault();await api('/api/customers',{method:'POST',body:Object.fromEntries(new FormData(e.target))});$('modal').classList.add('hidden');toast('Customer saved');customersPage()}}
async function invoicesPage(){const [d,ip,cp]=await Promise.all([api('/api/invoices'),api('/api/items'),api('/api/customers')]);invoices=d.invoices||[];items=ip.items||[];customers=cp.customers||[];$('page').innerHTML=`<div class='bar'><div><h3>GST Invoices</h3><p class='muted'>Drafts do not change stock. Finalized invoices deduct stock.</p></div><button class='primary' onclick='openInvoice()'>+ Create invoice</button></div><div class='panel tablewrap'><table><thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>${invoices.map(x=>`<tr><td>${esc(x.invoice_no)}</td><td>${esc(x.invoice_date)}</td><td>${esc(x.customer_name)}</td><td>₹${n(x.total)}</td><td><span class='badge'>${esc(x.status)}</span></td><td><button onclick="pdf('/api/invoices/${x.id}/pdf')">📄 PDF</button>${x.status==='DRAFT'?`<button onclick='finalizeInv(${x.id})'>Finalize</button>`:''}${x.status!=='CANCELLED'?`<button onclick='cancelInv(${x.id})'>Cancel</button>`:''}</td></tr>`).join('')}</tbody></table></div>`}
function openInvoice(){if(!items.length||!customers.length){toast('Add at least one product and one customer first.',true);return}modal('Create invoice',`<form id='invoiceForm'><label>Customer<select name='customer_id' required>${customers.map(c=>`<option value='${c.id}'>${esc(c.name)} ${esc(c.gstin)}</option>`).join('')}</select></label><label>Date<input type='date' name='invoice_date' value='${new Date().toISOString().slice(0,10)}'></label><div id='invoiceRows'></div><button type='button' onclick='addInvoiceRow()'>+ Add line</button><button class='primary'>Create draft</button></form>`);addInvoiceRow();$('invoiceForm').onsubmit=async e=>{e.preventDefault();const rows=[...document.querySelectorAll('.invrow')].map(r=>({item_id:Number(r.querySelector('select').value),quantity:Number(r.querySelector('input').value)}));await api('/api/invoices',{method:'POST',body:{customer_id:Number(e.target.customer_id.value),invoice_date:e.target.invoice_date.value,items:rows}});$('modal').classList.add('hidden');toast('Draft invoice created');invoicesPage()}}
function addInvoiceRow(){const x=document.createElement('div');x.className='invrow';x.innerHTML=`<select>${items.map(p=>`<option value='${p.id}'>${esc(p.name)} — ₹${n(p.selling_price)}</option>`).join('')}</select><input type='number' min='0.01' step='0.01' value='1'><button type='button' onclick='this.parentElement.remove()'>×</button>`;$('invoiceRows').appendChild(x)}
async function finalizeInv(id){if(!confirm('Finalize invoice and deduct stock?'))return;try{await api('/api/invoices/'+id+'/finalize',{method:'POST'});toast('Invoice finalized');invoicesPage()}catch(e){toast(e.message,true)}} async function cancelInv(id){if(!confirm('Cancel this invoice? Finalized invoices reverse their stock movement.'))return;try{await api('/api/invoices/'+id+'/cancel',{method:'POST'});toast('Invoice cancelled');invoicesPage()}catch(e){toast(e.message,true)}}
async function prepareBillFile(file){
  if(!file||!file.type.startsWith('image/'))return file;
  // OCR.space's current free API has a 1 MB upload limit. Camera photos are
  // commonly larger, so resize/compress only the upload copy in the browser.
  if(file.size<=900*1024)return file;
  const bitmap=await createImageBitmap(file);
  const maxSide=2200;
  const scale=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(bitmap.width*scale));
  canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
  bitmap.close();
  for(const quality of [0.82,0.72,0.62,0.52,0.42]){
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
    if(blob&&blob.size<=900*1024){
      return new File([blob],String(file.name||'bill.jpg').replace(/\.[^.]+$/i,'.jpg'),{type:'image/jpeg',lastModified:Date.now()});
    }
  }
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.35));
  if(blob)return new File([blob],String(file.name||'bill.jpg').replace(/\.[^.]+$/i,'.jpg'),{type:'image/jpeg',lastModified:Date.now()});
  return file;
}

async function purchasesPage(){
  const d=await api('/api/purchases');
  $('page').innerHTML=`<div class='bar'><div><h3>Purchase bills</h3><p class='muted'>Upload the supplier bill. The system extracts seller/buyer IDs, HSN, SKU, quantity, rate, GST and totals, then updates stock automatically when imported.</p></div><label class='upload primary'>📥 Upload bill<input id='bill' type='file' accept='.pdf,.jpg,.jpeg,.png,.webp' hidden></label></div>
  <div class='panel tablewrap'><table><thead><tr><th>Bill</th><th>Seller</th><th>Seller ID</th><th>Invoice</th><th>Buying amount</th><th>Status</th></tr></thead><tbody>${(d.purchases||[]).map(x=>`<tr><td>${esc(x.original_filename)}</td><td>${esc(x.supplier_name)}</td><td>${esc(x.seller_id)}</td><td>${esc(x.invoice_number)}</td><td>₹${n(x.invoice_total)}</td><td>${esc(x.status)}</td></tr>`).join('')||'<tr><td colspan="6" class="muted">No purchase bills yet.</td></tr>'}</tbody></table></div>`;
  $('bill').onchange=uploadBill;
}
async function uploadBill(e){
  const f=e.target.files[0]; if(!f)return;
  try{
    const uploadFile=await prepareBillFile(f);
    const fd=new FormData(); fd.append('bill',uploadFile,uploadFile.name);
    const d=await api('/api/purchases/extract',{method:'POST',body:fd}); const p=d.purchase;
    modal('Purchase bill extracted',`
      <div class='grid two'>
        <div><b>Seller:</b> ${esc(p.supplier_name||'-')}<br><b>Seller ID:</b> ${esc(p.seller_id||'-')}<br><b>Seller GSTIN:</b> ${esc(p.supplier_gstin||'-')}<br><b>Seller PAN:</b> ${esc(p.seller_pan||'-')}<br><b>Seller phone:</b> ${esc(p.seller_phone||'-')}<br><b>Seller address:</b> ${esc(p.seller_address||'-')}</div>
        <div><b>Purchaser:</b> ${esc(p.buyer_name||'-')}<br><b>Purchaser ID:</b> ${esc(p.buyer_id||'-')}<br><b>Purchaser GSTIN:</b> ${esc(p.buyer_gstin||'-')}<br><b>Purchaser PAN:</b> ${esc(p.buyer_pan||'-')}<br><b>Purchaser address:</b> ${esc(p.buyer_address||'-')}<br><b>Invoice:</b> ${esc(p.invoice_number||'-')}<br><b>Date:</b> ${esc(p.invoice_date||'-')}<br><b>Payment:</b> ${esc(p.payment_method||'-')}<br><b>Reverse charge:</b> ${esc(p.reverse_charge||'-')}</div>      </div>
      <div class='tablewrap'><table><thead><tr><th>Product</th><th>SKU</th><th>HSN</th><th>Qty</th><th>Unit</th><th>Buying rate</th><th>GST</th><th>Line total</th></tr></thead><tbody>
      ${(p.items||[]).map(x=>`<tr><td>${esc(x.extracted_name)}</td><td>${esc(x.sku||'-')}</td><td>${esc(x.hsn_code||'-')}</td><td>${n(x.quantity)}</td><td>${esc(x.unit)}</td><td>₹${n(x.purchase_price)}</td><td>${n(x.gst_rate)}%</td><td>₹${n(x.line_total)}</td></tr>`).join('')}
      </tbody></table></div>
      <div class='grid stats'>
        <div class='card'><small>Taxable amount</small><strong>₹${n(p.taxable_total)}</strong></div>
        <div class='card'><small>CGST / SGST</small><strong>₹${n(p.cgst)} / ₹${n(p.sgst)}</strong></div>
        <div class='card'><small>Total tax</small><strong>₹${n(p.tax_total)}</strong></div>
        <div class='card'><small>Round off</small><strong>₹${n(p.round_off)}</strong></div>
        <div class='card'><small>Buying amount</small><strong>₹${n(p.invoice_total)}</strong></div>
      </div>
      <p class='muted'>No HSN, SKU or stock quantity needs to be typed manually. Existing products are matched automatically; missing products are created automatically with an SKU generated from the bill.</p>
      <button id='confirmPurchase' class='primary'>Import bill & update stock</button>`);
    $('confirmPurchase').onclick=async()=>{
      await api('/api/purchases/'+p.id+'/confirm',{method:'POST',body:{items:(p.items||[]).map(x=>({id:x.id,name:x.extracted_name,sku:x.sku,supplier_sku:x.supplier_sku,quantity:x.quantity,unit:x.unit,purchase_price:x.purchase_price,gst_rate:x.gst_rate,hsn_code:x.hsn_code,item_id:x.matched_item_id}))}});
      $('modal').classList.add('hidden'); toast('Purchase imported. Products and stock updated automatically.'); purchasesPage();
    };
  }catch(x){toast(x.message,true)}
}
async function transactionsPage(){const d=await api('/api/transactions');$('page').innerHTML=`<div class='bar'><h3>Stock history</h3></div><div class='panel tablewrap'><table><thead><tr><th>Date</th><th>Product</th><th>Type</th><th>Qty</th><th>Reason</th></tr></thead><tbody>${(d.transactions||[]).map(x=>`<tr><td>${esc(x.created_at)}</td><td>${esc(x.item_name)}</td><td>${esc(x.type)}</td><td>${n(x.quantity)}</td><td>${esc(x.reason)}</td></tr>`).join('')}</tbody></table></div>`}
async function whatsappPage(){
  if(waTimer)clearInterval(waTimer);
  const render=async()=>{
    if(page!=='whatsapp')return;
    try{
      const d=await api('/api/whatsapp/status');
      const x=d.status||{};
      $('page').innerHTML=`<section class='panel wa'><div class='bar'><div><h3>WhatsApp connection</h3><p class='muted'>Only approved personal numbers are processed. Groups are ignored.</p></div><span class='badge ${String(x.status).toLowerCase()}'>${esc(x.status)}</span></div>${x.qr?`<div class='qr'><img src='${x.qr}'><p>WhatsApp → Linked Devices → Link a device</p></div>`:`<div class='empty'>${esc(x.message||'No QR is currently required.')}</div>`}<button onclick='restartWA()'>Reconnect</button></section>`;
      $('waMini').textContent='● '+(x.status==='CONNECTED'?'WhatsApp connected':'WhatsApp '+String(x.status||'offline').toLowerCase());
    }catch(e){if(page==='whatsapp')toast(e.message,true)}
  };
  await render();
  waTimer=setInterval(render,3000);
}
async function restartWA(){await api('/api/whatsapp/restart',{method:'POST'});toast('WhatsApp restart requested');setTimeout(whatsappPage,1000)}
async function settingsPage(){const d=await api('/api/settings');const b=d.business;business=b;$('page').innerHTML=`<section class='panel'><h3>Business settings</h3><form id='settingsForm' class='formgrid'><label>Firm ID<input value='${esc(b.firm_id)}' disabled></label><label>Business name<input name='name' value='${esc(b.name)}'></label><label>GSTIN<input name='gstin' value='${esc(b.gstin)}'></label><label>State<input name='state' value='${esc(b.state)}'></label><label>State code<input name='state_code' value='${esc(b.state_code)}'></label><label>Phone<input name='phone' value='${esc(b.phone)}'></label><label>Email<input name='email' value='${esc(b.email)}'></label><label>Invoice prefix<input name='invoice_prefix' value='${esc(b.invoice_prefix)}'></label><label class='wide'>Address<textarea name='address'>${esc(b.address)}</textarea></label><button class='primary'>Save settings</button></form></section>`;$('settingsForm').onsubmit=async e=>{e.preventDefault();await api('/api/settings',{method:'PUT',body:Object.fromEntries(new FormData(e.target))});toast('Settings saved')}}
function modal(t,body){$('modalTitle').textContent=t;$('modalBody').innerHTML=body;$('modal').classList.remove('hidden')}
async function boot(){try{const d=await api('/api/auth/me');business=d.business;showApp();go('dashboard')}catch{showLogin()}} boot();