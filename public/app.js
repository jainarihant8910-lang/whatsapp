const $=id=>document.getElementById(id); let csrf=sessionStorage.getItem('dm_csrf')||''; let sessionToken=sessionStorage.getItem('dm_token')||''; let business=null; let page='dashboard'; let items=[],customers=[],orders=[],invoices=[]; let waTimer=null;
const esc=x=>String(x??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); const n=x=>Number(x||0).toLocaleString('en-IN',{maximumFractionDigits:2});
async function api(url,opt={}){opt.headers={...(opt.headers||{})};if(!(opt.body instanceof FormData))opt.headers['Content-Type']='application/json';if(sessionToken)opt.headers['Authorization']='Bearer '+sessionToken;if(opt.method&&opt.method!=='GET')opt.headers['x-csrf-token']=csrf;if(opt.body&&!(opt.body instanceof FormData))opt.body=JSON.stringify(opt.body);const r=await fetch(url,{...opt,credentials:'same-origin'});let d={};try{d=await r.json()}catch{}if(r.status===401){showLogin();throw Error('Login required')}if(!r.ok)throw Error(d.error||'Request failed');return d}
function toast(m,bad=false){const x=document.createElement('div');x.className='toast '+(bad?'bad':'');x.textContent=m;$('toast').appendChild(x);setTimeout(()=>x.remove(),3500)}
function showLogin(){ $('appView').classList.add('hidden');$('loginView').classList.remove('hidden') } function showApp(){ $('loginView').classList.add('hidden');$('appView').classList.remove('hidden');$('firmLabel').textContent=business?.firm_id||'' }
$('loginTab').onclick=()=>{$('loginTab').classList.add('active');$('registerTab').classList.remove('active');$('loginForm').classList.remove('hidden');$('registerForm').classList.add('hidden')}; $('registerTab').onclick=()=>{$('registerTab').classList.add('active');$('loginTab').classList.remove('active');$('registerForm').classList.remove('hidden');$('loginForm').classList.add('hidden')};
$('loginForm').onsubmit=async e=>{e.preventDefault();try{const d=await api('/api/auth/login',{method:'POST',body:{firm_id:$('loginFirm').value,password:$('loginPass').value}});sessionToken=d.token;csrf=d.csrf;business=d.business;sessionStorage.setItem('dm_token',sessionToken);sessionStorage.setItem('dm_csrf',csrf);showApp();go('dashboard')}catch(x){$('authMsg').textContent=x.message}};
$('registerForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/auth/register',{method:'POST',body:{firm_id:$('regFirm').value,name:$('regName').value,password:$('regPass').value}});toast('Business created. Sign in now.');$('loginTab').click();$('loginFirm').value=$('regFirm').value}catch(x){$('authMsg').textContent=x.message}};
$('logout').onclick=async()=>{try{await api('/api/auth/logout',{method:'POST'})}catch{}sessionStorage.removeItem('dm_token');sessionStorage.removeItem('dm_csrf');sessionToken='';csrf='';showLogin()}; $('refresh').onclick=()=>load(); $('menu').onclick=()=>document.body.classList.toggle('open');
document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>go(b.dataset.page)); $('closeModal').onclick=()=>$('modal').classList.add('hidden');
async function go(p){page=p;document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('active',x.dataset.page===p));$('title').textContent=p==='analytics'?'Sales & Profit':p[0].toUpperCase()+p.slice(1);$('subtitle').textContent=p==='dashboard'?'Business overview':p==='analytics'?'Revenue, cost and gross-profit analysis':'Manage '+p;document.body.classList.remove('open');await load()}
async function load(){try{if(page==='dashboard')return dashboard();if(page==='analytics')return analyticsPage();if(page==='orders')return ordersPage();if(page==='products')return productsPage();if(page==='masters')return mastersPage();if(page==='customers')return customersPage();if(page==='senders')return sendersPage();if(page==='invoices')return invoicesPage();if(page==='transactions')return transactionsPage();if(page==='whatsapp')return whatsappPage();if(page==='settings')return settingsPage()}catch(e){toast(e.message,true)}}
function card(title,value,sub){return `<div class='card'><small>${esc(title)}</small><strong>${esc(value)}</strong><span>${esc(sub||'')}</span></div>`}
async function dashboard(){const d=await api('/api/dashboard');const p=await api('/api/items');items=p.items||[];$('page').innerHTML=`<div class='grid stats'>${card('Today orders',d.todayOrders,'WhatsApp + manual')}${card('All orders',d.orders,'Recorded deliveries')}${card('Products',d.products,'Inventory master')}${card('Low stock',d.lowStock,'Needs attention')}${card('Pending orders',d.pending,'Confirmation pending')}${card('Invoices',d.invoices,'Draft + finalized')}${card('Stock value','₹'+n(d.stockValue),'At purchase price')}</div><div class='grid two'><section class='panel'><h3>Quick actions</h3><div class='actions'><button class='primary' onclick="openProduct()">+ Product</button><button onclick="openCustomer()">+ Customer</button><button onclick="openMergeOrdersInvoice()">🔗 Merge orders</button></div></section><section class='panel'><h3>Low stock</h3>${items.filter(x=>x.low_stock).slice(0,8).map(x=>`<div class='row'><span>${esc(x.name)}</span><b>${n(x.current_stock)} / min ${n(x.minimum_stock)}</b></div>`).join('')||'<div class="muted">No low-stock products.</div>'}</section></div>`}
let productSearch='', productFilter='ALL';
function renderProducts(){
 const q=productSearch.toLowerCase().trim();
 const filtered=items.filter(x=>{
   const text=[x.name,x.sku,x.hsn_code,x.category,x.unit].join(' ').toLowerCase();
   const matches=!q||text.includes(q);
   const stock=Number(x.current_stock||0);
   const matchesFilter=productFilter==='LOW'?!!x.low_stock:productFilter==='OUT'?stock===0:productFilter==='IN'?stock>0:true;
   return matches&&matchesFilter;
 });
 const body=filtered.map(x=>`<tr><td><b>${esc(x.name)}</b><small>${esc(x.category||x.unit||'')}</small></td><td>${esc(x.sku)}</td><td>${esc(x.hsn_code)}</td><td>${n(x.current_stock)} ${x.low_stock?'⚠️':''}</td><td>₹${n(x.purchase_price)}</td><td>₹${n(x.selling_price)}</td><td>${n(x.gst_rate)}%</td><td><button onclick='stockIn(${x.id})'>+ Stock</button>${Number(x.current_stock)===0?`<button class='danger' onclick='deleteProduct(${x.id},${JSON.stringify(x.name)})'>Delete</button>`:''}<button onclick='manageAliases(${x.id},${JSON.stringify(x.name)})'>Aliases</button></td></tr>`).join('')||'<tr><td colspan="8" class="muted">No products match your search/filter.</td></tr>';
 $('productTableBody').innerHTML=body;
 $('productCount').textContent=`${filtered.length} of ${items.length} products`;
}
async function productsPage(){
 const d=await api('/api/items');items=d.items||[];
 $('page').innerHTML=`<div class='bar'><div><h3>Products & stock</h3><p class='muted'>Selling price, GST, HSN, SKU and inventory. WhatsApp names can use saved aliases.</p></div><button class='primary' onclick="openProduct()">+ Add product</button></div>
 <div class='panel product-tools'><div class='searchbox'><span>🔍</span><input id='productSearch' placeholder='Search product, SKU, HSN or category…' autocomplete='off'><button type='button' onclick="productSearch=document.getElementById('productSearch').value;renderProducts()">Search</button></div><select id='productFilter'><option value='ALL'>All stock</option><option value='IN'>In stock</option><option value='LOW'>Low stock</option><option value='OUT'>Out of stock</option></select><span id='productCount' class='muted'></span></div>
 <div class='panel tablewrap'><table><thead><tr><th>Product</th><th>SKU</th><th>HSN</th><th>Stock</th><th>Buy</th><th>Sell</th><th>GST</th><th></th></tr></thead><tbody id='productTableBody'></tbody></table></div>`;
 $('productSearch').oninput=e=>{productSearch=e.target.value;renderProducts()};
 $('productSearch').onkeydown=e=>{if(e.key==='Enter'){productSearch=e.target.value;renderProducts()}};
 $('productFilter').onchange=e=>{productFilter=e.target.value;renderProducts()};
 renderProducts();
}
async function mastersPage(){
 const d=await api('/api/hsn');const rows=d.hsn||[];
 $('page').innerHTML=`<div class='bar'><div><h3>SKU / HSN Master</h3><p class='muted'>Store HSN/SAC codes and GST rates here. DeliveryOS never invents an HSN code.</p></div><button class='primary' onclick='openHsn()'>+ Add HSN/SAC</button></div>
 <div class='panel'><h4>HSN / SAC master</h4><div class='tablewrap'><table><thead><tr><th>Code</th><th>Description</th><th>GST</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(x=>`<tr><td><b>${esc(x.code)}</b></td><td>${esc(x.description)}</td><td>${n(x.gst_rate)}%</td><td>${x.active?'Active':'Inactive'}</td><td><button onclick='editHsn(${x.id},${JSON.stringify(x.code)},${JSON.stringify(x.description)},${x.gst_rate})'>Edit</button><button class='danger' onclick='deleteHsn(${x.id})'>Delete</button></td></tr>`).join('')||'<tr><td colspan="5" class="muted">No HSN/SAC codes configured yet.</td></tr>'}</tbody></table></div></div>
 <div class='panel'><h4>How product matching works</h4><p class='muted'>WhatsApp input is matched by exact product name, SKU, or a saved alias. If there is no match, the order line is rejected instead of guessing.</p></div>`;
}
function openHsn(id='',code='',description='',gst=''){modal(id?'Edit HSN/SAC':'Add HSN/SAC',`<form id='hsnForm' class='formgrid'><label>HSN / SAC code<input name='code' value='${esc(code)}' inputmode='numeric' pattern='[0-9]{4,8}' required></label><label>Description<input name='description' value='${esc(description)}'></label><label>GST %<input name='gst_rate' type='number' min='0' step='0.01' value='${gst}'></label><button class='primary'>Save HSN/SAC</button></form>`);$('hsnForm').onsubmit=async e=>{e.preventDefault();try{await api(id?'/api/hsn/'+id:'/api/hsn',{method:id?'PUT':'POST',body:Object.fromEntries(new FormData(e.target))});$('modal').classList.add('hidden');toast('HSN/SAC saved');mastersPage()}catch(x){toast(x.message,true)}}}
function editHsn(id,code,description,gst){openHsn(id,code,description,gst)}
async function deleteHsn(id){if(!confirm('Delete this HSN/SAC master entry? Products already using the code keep their saved value.'))return;try{await api('/api/hsn/'+id,{method:'DELETE'});toast('HSN/SAC deleted');mastersPage()}catch(e){toast(e.message,true)}}
async function manageAliases(id,name){
 const d=await api('/api/items/'+id+'/aliases');const rows=d.aliases||[];
 modal('Aliases — '+name,`<p class='muted'>Messages such as “A4 paper” can be mapped to this exact product. One alias per entry.</p><div id='aliasRows'>${rows.map(x=>`<div class='row'><span>${esc(x.alias)}</span><button class='danger' onclick='deleteAlias(${x.id},${id},${JSON.stringify(name)})'>Delete</button></div>`).join('')||'<div class="muted">No aliases yet.</div>'}</div><form id='aliasForm' class='formgrid'><label class='wide'>New alias<input name='alias' placeholder='e.g. A4 paper'></label><button class='primary'>Add alias</button></form>`);
 $('aliasForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/items/'+id+'/aliases',{method:'POST',body:{alias:new FormData(e.target).get('alias')}});manageAliases(id,name)}catch(x){toast(x.message,true)}};
}
async function deleteAlias(aliasId,itemId,name){try{await api('/api/item-aliases/'+aliasId,{method:'DELETE'});manageAliases(itemId,name)}catch(e){toast(e.message,true)}}
async function openProduct(prefill={}){
 const hm=await api('/api/hsn');
 modal('Add product',`<form id='productForm' class='formgrid'>
 <label class='wide'>Product name<input id='productName' name='name' required value='${esc(prefill.name||'')}' placeholder='e.g. A4 paper, cutting machine, mobile phone'></label>
 <label>Product group/category<div class='inputrow'><input id='productCategory' name='category' value='${esc(prefill.category||'')}' placeholder='e.g. laptops, stationery, mobile phones'><button type='button' title='Search HSN by product category' onclick='searchProductClassification()'>🔍</button></div></label>
 <label>SKU<input id='productSku' name='sku' value='${esc(prefill.sku||'')}' placeholder='Leave blank to auto-generate'></label>
 <label>HSN/SAC<div class='inputrow'><select name='hsn_code' id='productHsn'><option value=''>Select from HSN master</option></select><button type='button' title='Search HSN / GST' onclick='searchProductClassification()'>🔍</button></div></label>
 <label>GST %<input id='productGst' name='gst_rate' type='number' min='0' step='0.01' value='${esc(prefill.gst_rate??'')}' placeholder='Auto-filled'></label>
 <label>Unit<input name='unit' value='PCS'></label><label>Opening stock<input name='opening_stock' type='number' min='0' value='0'></label><label>Minimum stock<input name='minimum_stock' type='number' min='0' value='0'></label><label>Purchase price<input name='purchase_price' type='number' min='0' step='0.01'></label><label>Selling price<input name='selling_price' type='number' min='0' step='0.01'></label><button class='primary'>Save product</button></form>`);
 const hs=$('productHsn');(hm.hsn||[]).forEach(x=>{const o=document.createElement('option');o.value=x.code;o.textContent=x.code+' — '+x.description+' ('+n(x.gst_rate)+'%)';hs.appendChild(o)}); if(prefill.hsn_code)hs.value=String(prefill.hsn_code);
 $('productForm').onsubmit=async e=>{e.preventDefault();try{const d=Object.fromEntries(new FormData(e.target));await api('/api/items',{method:'POST',body:d});$('modal').classList.add('hidden');toast('Product saved');productsPage()}catch(x){toast(x.message,true)}}
}
async function searchProductClassification(){
 const draftForm=$('productForm');
 const draft=draftForm?Object.fromEntries(new FormData(draftForm)):{};
 const q=String(draft.category||$('productCategory')?.value||'').trim();
 window.pendingProductDraft={...draft,searchCategory:q};
 window.pendingProductName=q;
 if(q.length<2){toast('Enter at least 2 characters of the product category.',true);return}
 try{
  toast('Searching HSN / product classification…');
  const d=await api('/api/hsn/search?q='+encodeURIComponent(q));
  const rows=d.results||[];
  if(!rows.length){toast('No classification found. You can enter HSN, SKU and GST manually.',true);return}
  modal('Select product classification',`<p class='muted'>Choose the closest match. HSN/GST classification should be verified for the actual product before invoicing.</p><div class='tablewrap'><table><thead><tr><th>HSN</th><th>Group</th><th>Description</th><th>GST</th><th></th></tr></thead><tbody>${rows.map((x,i)=>`<tr><td><b>${esc(x.hsn_code)}</b></td><td>${esc(x.category||'—')}</td><td>${esc(x.description)}</td><td>${n(x.gst_rate)}%</td><td><button type='button' onclick='applyClassification(${JSON.stringify(x).replace(/</g,'&lt;')})'>Use</button></td></tr>`).join('')}</tbody></table></div>`);
 }catch(e){toast(e.message,true)}
}
async function applyClassification(x){
 const draft=window.pendingProductDraft||{};
 const name=String(draft.name||window.pendingProductName||'').trim();
 const sku=String(draft.sku||'').trim()||makeLocalSku(name,x.hsn_code);
 const prefill={...draft,name,category:x.category||draft.category||x.description||'',sku,hsn_code:x.hsn_code,gst_rate:x.gst_rate??draft.gst_rate??0};
 $('modal').classList.add('hidden');
 await openProduct(prefill);
 const hs=$('productHsn');
 if(hs&&x.hsn_code){let opt=[...hs.options].find(o=>String(o.value)===String(x.hsn_code));if(!opt){opt=document.createElement('option');opt.value=String(x.hsn_code);opt.textContent=String(x.hsn_code)+' — '+String(x.description||'')+' ('+n(x.gst_rate)+'%)';hs.appendChild(opt)}hs.value=String(x.hsn_code)}
 toast('HSN, GST, group and SKU filled from classification');
}
function makeLocalSku(name,hsn){const words=String(name).toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim().split(/\\s+/).filter(Boolean);const prefix=words.slice(0,3).map(x=>x.slice(0,3)).join('');return (prefix||'PRD')+'-'+String(hsn||'').replace(/\\D/g,'').slice(-4)+'-'+Date.now().toString().slice(-4)}
async function stockIn(id){const q=prompt('Quantity to add');if(q===null)return;try{await api('/api/items/'+id+'/stock',{method:'POST',body:{quantity:Number(q),reason:'Manual stock addition'}});toast('Stock added');productsPage()}catch(e){toast(e.message,true)}}
async function deleteProduct(id,name){if(!confirm('Delete "'+name+'" from Products? This is allowed only when stock is zero. Historical orders and stock history are kept.'))return;try{await api('/api/items/'+id,{method:'DELETE'});toast('Product deleted');productsPage()}catch(e){toast(e.message,true)}}
let orderSearch='', orderStatus='ALL', orderSource='ALL';
function renderOrders(){
 const q=orderSearch.toLowerCase().trim();
 const filtered=orders.filter(o=>{
   const text=[o.id,o.delivered_to,o.item_names,o.items,o.date,o.status,o.source_type].join(' ').toLowerCase();
   return (!q||text.includes(q)) &&
     (orderStatus==='ALL'||String(o.status||'').toUpperCase()===orderStatus) &&
     (orderSource==='ALL'||String(o.source_type||'WHATSAPP').toUpperCase()===orderSource);
 });
 const body=filtered.map(o=>`<tr><td>#${o.id}</td><td><span class='badge'>${String(o.source_type||'WHATSAPP')==='MANUAL'?'Manual':'WhatsApp'}</span></td><td>${esc(o.date)} ${esc(o.time)}</td><td>${esc(o.delivered_to)}</td><td>${esc(o.item_names||o.items||'View order')}</td><td>${n(o.accepted_items)}</td><td>${n(o.returned_items||0)}</td><td>${n(Math.max(0,Number(o.accepted_items||0)-Number(o.returned_items||0)))} </td><td><span class='badge ${String(o.status).toLowerCase()}'>${esc(o.status)}</span></td><td><button onclick="voice(${o.id})">🔊 Voice</button><button onclick="pdf('/api/orders/${o.id}/invoice-pdf')">🧾 Invoice PDF</button>${['SUCCESS','PARTIAL','PARTIAL_RETURN'].includes(o.status)?`<button onclick="openReturn(${o.id})">↩ Return</button>`:''}</td></tr>`).join('')||'<tr><td colspan="10" class="muted">No orders match your search/filter.</td></tr>';
 $('orderTableBody').innerHTML=body;
 $('orderCount').textContent=`${filtered.length} of ${orders.length} orders`;
}
async function ordersPage(){
 const d=await api('/api/orders');orders=d.orders||[];
 $('page').innerHTML=`<div class='bar'><div><h3>Orders</h3><p class='muted'>WhatsApp and manually entered orders are stored together. Returns automatically add stock back.</p></div><button class='primary' onclick="openManualOrder()">+ Manual order</button><button onclick="openReturnPicker()">↩ Quick return</button><button onclick="go('transactions')">Stock history</button></div>
 <div class='panel order-tools'><div class='searchbox'><span>🔍</span><input id='orderSearch' placeholder='Search order, customer, product or date…' autocomplete='off'><button type='button' onclick="orderSearch=document.getElementById('orderSearch').value;renderOrders()">Search</button></div><select id='orderStatus'><option value='ALL'>All status</option><option value='SUCCESS'>Success</option><option value='PARTIAL'>Partial</option><option value='PARTIAL_RETURN'>Partial return</option><option value='RETURNED'>Returned</option><option value='PENDING'>Pending</option><option value='REJECTED'>Rejected</option></select><select id='orderSource'><option value='ALL'>All sources</option><option value='WHATSAPP'>WhatsApp</option><option value='MANUAL'>Manual</option></select><span id='orderCount' class='muted'></span></div>
 <div class='panel tablewrap'><table><thead><tr><th>Order</th><th>Source</th><th>Date</th><th>Delivered to</th><th>Item names</th><th>Qty</th><th>Returned</th><th>Remaining</th><th>Status</th><th>Actions</th></tr></thead><tbody id='orderTableBody'></tbody></table></div>`;
 $('orderSearch').oninput=e=>{orderSearch=e.target.value;renderOrders()};
 $('orderSearch').onkeydown=e=>{if(e.key==='Enter'){orderSearch=e.target.value;renderOrders()}};
 $('orderStatus').onchange=e=>{orderStatus=e.target.value;renderOrders()};
 $('orderSource').onchange=e=>{orderSource=e.target.value;renderOrders()};
 renderOrders();
}
async function openManualOrder(){
  const products=await api('/api/items'); const ps=products.items||[];
  const cp=await api('/api/customers'); const cs=cp.customers||[];
  if(!ps.length||!cs.length){toast('Add at least one product and one customer first.',true);return}
  modal('Create manual order',`<form id='manualOrderForm'>
    <label>Customer / Delivered to<select name='deliveredTo' required>${cs.map(c=>`<option value="${esc(c.name)}">${esc(c.name)}${c.phone?' — '+esc(c.phone):''}</option>`).join('')}</select></label>
    <label>Date<input type='date' name='date' value='${new Date().toISOString().slice(0,10)}'></label>
    <div id='manualOrderRows'></div>
    <button type='button' onclick='addManualOrderRow()'>+ Add product</button>
    <button class='primary'>Create manual order</button>
  </form>`);
  window.manualOrderProducts=ps; addManualOrderRow();
  $('manualOrderForm').onsubmit=async e=>{
    e.preventDefault();
    const rows=[...document.querySelectorAll('.manualrow')].map(r=>({item:r.querySelector('select').value,quantity:Number(r.querySelector('input').value)})).filter(x=>x.quantity>0);
    if(!rows.length){toast('Add at least one product.',true);return}
    try{await api('/api/orders/manual',{method:'POST',body:{deliveredTo:e.target.deliveredTo.value,date:e.target.date.value,items:rows}});$('modal').classList.add('hidden');toast('Manual order created');ordersPage()}catch(x){toast(x.message,true)}
  };
}
function addManualOrderRow(){
  const ps=window.manualOrderProducts||[]; const x=document.createElement('div'); x.className='manualrow';
  x.innerHTML=`<select>${ps.map(p=>`<option value="${esc(p.name)}">${esc(p.name)} — stock ${n(p.current_stock)} — ₹${n(p.selling_price)}</option>`).join('')}</select><input type='number' min='0.01' step='0.01' value='1'><button type='button' onclick='this.parentElement.remove()'>×</button>`;
  $('manualOrderRows').appendChild(x);
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
async function invoicesPage(){const [d,cp]=await Promise.all([api('/api/invoices'),api('/api/customers')]);invoices=d.invoices||[];customers=cp.customers||[];$('page').innerHTML=`<div class='bar'><div><h3>GST Invoices</h3><p class='muted'>Invoices are created only by merging two or more existing orders for the same customer.</p></div><div class='actions'><button class='primary' onclick='openMergeOrdersInvoice()'>🔗 Merge orders into bill</button></div></div><div class='panel tablewrap'><table><thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Source</th><th>Orders</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>${invoices.map(x=>`<tr><td>${esc(x.invoice_no)}</td><td>${esc(x.invoice_date)}</td><td>${esc(x.customer_name)}</td><td>${x.source_type==='ORDERS'?'Merged orders':'Manual'}</td><td>${x.order_count||0}</td><td>₹${n(x.total)}</td><td><span class='badge'>${esc(x.status)}</span></td><td><button onclick="pdf('/api/invoices/${x.id}/pdf')">📄 PDF</button>${x.status==='DRAFT'?`<button onclick='finalizeInv(${x.id})'>Finalize</button>`:''}${x.status!=='CANCELLED'?`<button onclick='cancelInv(${x.id})'>Cancel</button>`:''}</td></tr>`).join('')||'<tr><td colspan="8" class="muted">No invoices yet.</td></tr>'}</tbody></table></div>`}

function openMergeOrdersInvoice(){if(!customers.length){toast('Add a customer first.',true);return}modal('Merge customer orders into one bill',`<form id='mergeInvoiceForm'><label>Customer<select id='mergeCustomer' name='customer_id' required><option value=''>Select customer</option>${customers.map(c=>`<option value='${c.id}'>${esc(c.name)}${c.phone?' — '+esc(c.phone):''}</option>`).join('')}</select></label><label>Date<input type='date' name='invoice_date' value='${new Date().toISOString().slice(0,10)}'></label><div id='mergeOrderList' class='panel'><div class='muted'>Select a customer to load all of their orders.</div></div><button class='primary'>Create merged draft</button></form>`);$('mergeCustomer').onchange=loadMergeOrders;$('mergeInvoiceForm').onsubmit=createMergedInvoice}
async function loadMergeOrders(){const id=Number($('mergeCustomer').value);const box=$('mergeOrderList');if(!id){box.innerHTML='<div class="muted">Select a customer to load billable orders.</div>';return}try{const d=await api('/api/invoice-orders?customer_id='+id);const rows=d.orders||[];box.innerHTML=rows.length?'<h4>All orders for this customer</h4>'+rows.map(o=>`<label class='row' style='gap:10px;align-items:flex-start;opacity:${o.already_billed?'0.6':'1'}'><input type='checkbox' name='order_id' value='${o.id}' ${o.already_billed||Number(o.billable_qty)<=0?'disabled':''}><span><b>Order #${o.id}</b> — ${esc(o.date||'')} ${o.time?esc(o.time):''} · <b>${String(o.source_type||'WHATSAPP')==='MANUAL'?'Manual':'WhatsApp'}</b><br><small>${esc(o.item_names||'No accepted items')} · ${n(o.billable_qty)} billable qty ${o.already_billed?' · Already billed in '+esc(o.linked_invoice_no):''}</small></span></label>`).join(''):'<div class="muted">No orders found for this customer name.</div>'}catch(e){box.innerHTML='<div class="msg">'+esc(e.message)+'</div>'}}
async function createMergedInvoice(e){e.preventDefault();const ids=[...document.querySelectorAll('input[name="order_id"]:checked')].map(x=>Number(x.value));if(ids.length<2){toast('Select at least two orders to merge.',true);return}try{await api('/api/invoices',{method:'POST',body:{customer_id:Number(e.target.customer_id.value),invoice_date:e.target.invoice_date.value,order_ids:ids}});$('modal').classList.add('hidden');toast(ids.length+' orders merged into one draft invoice');invoicesPage()}catch(x){toast(x.message,true)}}

function openInvoice(){toast('Invoices can only be created by merging existing orders.',true)}
function addInvoiceRow(){const x=document.createElement('div');x.className='invrow';x.innerHTML=`<select>${items.map(p=>`<option value='${p.id}'>${esc(p.name)} — ₹${n(p.selling_price)}</option>`).join('')}</select><input type='number' min='0.01' step='0.01' value='1'><button type='button' onclick='this.parentElement.remove()'>×</button>`;$('invoiceRows').appendChild(x)}
async function finalizeInv(id){if(!confirm('Finalize invoice?'))return;try{await api('/api/invoices/'+id+'/finalize',{method:'POST'});toast('Invoice finalized');invoicesPage()}catch(e){toast(e.message,true)}} async function cancelInv(id){if(!confirm('Cancel this invoice? A merged-order invoice does not change stock because the original orders already deducted stock.'))return;try{await api('/api/invoices/'+id+'/cancel',{method:'POST'});toast('Invoice cancelled');invoicesPage()}catch(e){toast(e.message,true)}}
let analyticsFilters={from:'',to:'',product:'',customer:'',source:'ALL'};
function moneyRs(x){return '₹'+n(x)}
function pct(x){return n(x)+'%'}
function analyticsBarRows(rows,maxValue){
  return rows.length?rows.map(x=>{
    const width=maxValue&&x.profit!==null?Math.max(3,Math.min(100,Number(x.profit||0)/maxValue*100)):3;
    return `<div class='analytics-bar-row'><div class='analytics-bar-label'><span>${esc(x.name)}</span><b>${moneyRs(x.profit)}</b></div><div class='analytics-track'><div class='analytics-fill' style='width:${width}%'></div></div><small>${moneyRs(x.sales)} sales · ${n(x.units)} units · ${pct(x.margin)} margin</small></div>`;
  }).join(''):'<div class="empty">No sales found for these filters.</div>';
}
async function analyticsPage(){
  const [pd,cd]=await Promise.all([api('/api/items'),api('/api/customers')]);
  items=pd.items||[];customers=cd.customers||[];
  const today=new Date(), prior=new Date(today);prior.setDate(today.getDate()-29);
  const iso=x=>x.toISOString().slice(0,10);
  if(!analyticsFilters.from)analyticsFilters.from=iso(prior);
  if(!analyticsFilters.to)analyticsFilters.to=iso(today);
  $('page').innerHTML=`<div class='bar'><div><h3>Sales & Profit Analysis</h3><p class='muted'>Gross profit = net delivered sales minus product cost. Returns reduce the sold quantity.</p></div><button onclick='loadAnalytics()'>↻ Refresh analysis</button></div>
  <div class='panel analytics-filters'><label>From<input id='anFrom' type='date' value='${analyticsFilters.from}'></label><label>To<input id='anTo' type='date' value='${analyticsFilters.to}'></label><label>Product<select id='anProduct'><option value=''>All products</option>${items.map(x=>`<option value='${x.id}' ${String(analyticsFilters.product)===String(x.id)?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label><label>Customer<select id='anCustomer'><option value=''>All customers</option>${customers.map(x=>`<option value="${esc(x.name)}" ${analyticsFilters.customer===x.name?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label><label>Source<select id='anSource'><option value='ALL'>All sources</option><option value='WHATSAPP'>WhatsApp</option><option value='MANUAL'>Manual</option></select></label><button class='primary' onclick='loadAnalytics()'>Apply filters</button></div>
  <div id='analyticsBody'><div class='empty'>Loading analysis…</div></div>`;
  $('anSource').value=analyticsFilters.source;
  await loadAnalytics();
}
async function loadAnalytics(){
  const from=$('anFrom')?.value||analyticsFilters.from,to=$('anTo')?.value||analyticsFilters.to,product=$('anProduct')?.value||analyticsFilters.product,customer=$('anCustomer')?.value||analyticsFilters.customer,source=$('anSource')?.value||analyticsFilters.source;
  analyticsFilters={from,to,product,customer,source};
  const q=new URLSearchParams({from,to,product_id:product,customer,source});
  try{
    const d=await api('/api/analytics/sales?'+q.toString()),s=d.summary||{};
    const max=Math.max(1,...(d.products||[]).map(x=>Math.max(0,Number(x.profit||0))));
    const dailyMax=Math.max(1,...(d.daily||[]).map(x=>Number(x.sales||0)));
    $('analyticsBody').innerHTML=`<div class='grid stats analytics-stats'>${card('Net sales',moneyRs(s.sales),'After returns')}${card('Purchase value',moneyRs(s.purchase_value??s.cogs),'Cost of goods sold')}${card('Gross profit',s.cost_complete===false?'Cost missing':moneyRs(s.profit),s.cost_complete===false?('Missing cost for '+n(s.missing_cost_units)+' units'):pct(s.margin)+' margin')}${card('Orders',n(s.orders),'Delivered orders')}${card('Units sold',n(s.units),'Net quantity')}${card('Returned units',n(s.returned),'Returned quantity')}</div>
    <div class='grid two analytics-grid'><section class='panel'><div class='bar'><h3>Daily sales trend</h3><span class='muted'>${esc(from)} → ${esc(to)}</span></div>${(d.daily||[]).length?(d.daily||[]).map(x=>`<div class='analytics-bar-row'><div class='analytics-bar-label'><span>${esc(x.name)}</span><b>${moneyRs(x.sales)}</b></div><div class='analytics-track'><div class='analytics-fill' style='width:${Math.max(3,Number(x.sales||0)/dailyMax*100)}%'></div></div><small>Profit ${moneyRs(x.profit)} · ${pct(x.margin)}</small></div>`).join(''):'<div class="empty">No sales found.</div>'}</section>
    <section class='panel'><div class='bar'><h3>Profit by product</h3><span class='muted'>Top 20</span></div>${analyticsBarRows(d.products||[],max)}</section></div>
    <section class='panel'><div class='bar'><h3>Customer profitability</h3><span class='muted'>Net sales and gross profit</span></div><div class='tablewrap'><table><thead><tr><th>Customer</th><th>Orders</th><th>Units</th><th>Sales</th><th>Purchase value</th><th>Gross profit</th><th>Margin</th></tr></thead><tbody>${(d.customers||[]).map(x=>`<tr><td><b>${esc(x.name)}</b></td><td>${n(x.orders)}</td><td>${n(x.units)}</td><td>${moneyRs(x.sales)}</td><td>${moneyRs(x.purchase_value??x.cogs)}</td><td><b>${moneyRs(x.profit)}</b></td><td>${pct(x.margin)}</td></tr>`).join('')||'<tr><td colspan="7" class="muted">No customer sales found.</td></tr>'}</tbody></table></div></section>`;
  }catch(e){$('analyticsBody').innerHTML='<div class="msg">'+esc(e.message)+'</div>'}
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