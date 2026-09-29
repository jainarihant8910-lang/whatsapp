const sqlite3=require('sqlite3').verbose();
const crypto=require('crypto'); const fs=require('fs'); const path=require('path');
const dir=path.join(__dirname,'data'); fs.mkdirSync(dir,{recursive:true});
const db=new sqlite3.Database(path.join(dir,'platform.db')); db.configure('busyTimeout',15000);
const run=(s,p=[])=>new Promise((a,b)=>db.run(s,p,function(e){e?b(e):a({lastID:this.lastID,changes:this.changes})}));
const get=(s,p=[])=>new Promise((a,b)=>db.get(s,p,(e,r)=>e?b(e):a(r)));
const all=(s,p=[])=>new Promise((a,b)=>db.all(s,p,(e,r)=>e?b(e):a(r||[])));
const normalizePhone=v=>String(v||'').replace(/\D/g,'');
const money=v=>Math.round((Number(v)||0)*100)/100;
const clean=v=>String(v??'').trim().slice(0,500);
function hashPassword(p){const salt=crypto.randomBytes(16).toString('hex');const h=crypto.pbkdf2Sync(String(p),salt,210000,32,'sha256').toString('hex');return 'pbkdf2$210000$'+salt+'$'+h}
function verifyPassword(p,s){try{const [a,it,salt,h]=String(s).split('$');if(a!=='pbkdf2')return false;const x=crypto.pbkdf2Sync(String(p),salt,Number(it),32,'sha256');return crypto.timingSafeEqual(x,Buffer.from(h,'hex'))}catch{return false}}
const token=()=>crypto.randomBytes(32).toString('hex'); const sha=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
async function init(){
 await run('PRAGMA foreign_keys=ON');
 await run('CREATE TABLE IF NOT EXISTS businesses(id INTEGER PRIMARY KEY AUTOINCREMENT,firm_id TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password_hash TEXT NOT NULL,gstin TEXT DEFAULT "",address TEXT DEFAULT "",state TEXT DEFAULT "",state_code TEXT DEFAULT "",phone TEXT DEFAULT "",email TEXT DEFAULT "",invoice_prefix TEXT DEFAULT "INV",created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
 await run('CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL,username TEXT NOT NULL,role TEXT DEFAULT "OWNER",password_hash TEXT NOT NULL,UNIQUE(business_id,username))');
 await run('CREATE TABLE IF NOT EXISTS sessions(id INTEGER PRIMARY KEY AUTOINCREMENT,token_hash TEXT UNIQUE NOT NULL,csrf_hash TEXT NOT NULL,business_id INTEGER NOT NULL,user_id INTEGER,expires_at TEXT NOT NULL)');
 await run('CREATE TABLE IF NOT EXISTS items(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL,name TEXT NOT NULL,sku TEXT DEFAULT "",hsn_code TEXT DEFAULT "",unit TEXT DEFAULT "PCS",opening_stock REAL DEFAULT 0,current_stock REAL DEFAULT 0,minimum_stock REAL DEFAULT 0,purchase_price REAL DEFAULT 0,selling_price REAL DEFAULT 0,gst_rate REAL DEFAULT 0,UNIQUE(business_id,name COLLATE NOCASE))');
 await run('CREATE TABLE IF NOT EXISTS customers(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL,name TEXT NOT NULL,phone TEXT DEFAULT "",address TEXT DEFAULT "",gstin TEXT DEFAULT "",email TEXT DEFAULT "",state TEXT DEFAULT "",state_code TEXT DEFAULT "",notes TEXT DEFAULT "")');
 await run('CREATE TABLE IF NOT EXISTS senders(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL,whatsapp_id TEXT NOT NULL,name TEXT DEFAULT "",UNIQUE(business_id,whatsapp_id))');
 await run('CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL,date TEXT,time TEXT,delivered_to TEXT, sender_id INTEGER,whatsapp_message_id TEXT NOT NULL,whatsapp_from TEXT DEFAULT "",total_items INTEGER DEFAULT 0,accepted_items INTEGER DEFAULT 0,rejected_items INTEGER DEFAULT 0,status TEXT DEFAULT "PENDING",confirmation_sent INTEGER DEFAULT 0,confirmation_message_id TEXT,UNIQUE(business_id,whatsapp_message_id))');
 await run('CREATE TABLE IF NOT EXISTS order_items(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL,order_id INTEGER NOT NULL,item_id INTEGER,item_name TEXT,requested_quantity REAL,accepted_quantity REAL DEFAULT 0,rejected_quantity REAL DEFAULT 0,status TEXT,rejection_reason TEXT DEFAULT "",unit TEXT DEFAULT "PCS",rate REAL DEFAULT 0,hsn_code TEXT DEFAULT "",gst_rate REAL DEFAULT 0,taxable_value REAL DEFAULT 0,total_tax REAL DEFAULT 0,line_total REAL DEFAULT 0)');
 await run('CREATE TABLE IF NOT EXISTS order_returns(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL,order_id INTEGER NOT NULL,reason TEXT DEFAULT "",created_at TEXT DEFAULT CURRENT_TIMESTAMP,created_by INTEGER)');
 await run('CREATE TABLE IF NOT EXISTS order_return_items(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL,return_id INTEGER NOT NULL,order_item_id INTEGER NOT NULL,quantity REAL NOT NULL,reason TEXT DEFAULT "")');
 await run('CREATE TABLE IF NOT EXISTS order_returns(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL,order_id INTEGER NOT NULL,reason TEXT DEFAULT "",created_at TEXT DEFAULT CURRENT_TIMESTAMP,created_by INTEGER)');
 await run('CREATE TABLE IF NOT EXISTS order_return_items(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL,return_id INTEGER NOT NULL,order_item_id INTEGER NOT NULL,quantity REAL NOT NULL,reason TEXT DEFAULT "")');
 await run('CREATE TABLE IF NOT EXISTS stock_transactions(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL,item_id INTEGER,type TEXT,quantity REAL,reason TEXT,order_id INTEGER,order_item_id INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
 await run('CREATE TABLE IF NOT EXISTS processed_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL,message_id TEXT NOT NULL,whatsapp_from TEXT,sender_phone TEXT,body TEXT,UNIQUE(business_id,message_id))');
 await run('CREATE TABLE IF NOT EXISTS whatsapp_lid_map(business_id INTEGER NOT NULL,lid TEXT NOT NULL,phone TEXT,PRIMARY KEY(business_id,lid))');
 await run('CREATE TABLE IF NOT EXISTS whatsapp_sessions(business_id INTEGER PRIMARY KEY,status TEXT DEFAULT "DISCONNECTED",message TEXT DEFAULT "",qr TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)');
 await run('CREATE TABLE IF NOT EXISTS purchase_bills(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL,original_filename TEXT,file_type TEXT,file_hash TEXT,supplier_name TEXT DEFAULT "",supplier_gstin TEXT DEFAULT "",supplier_address TEXT DEFAULT "",invoice_number TEXT DEFAULT "",invoice_date TEXT DEFAULT "",place_of_supply TEXT DEFAULT "",raw_text TEXT DEFAULT "",status TEXT DEFAULT "REVIEW",created_at TEXT DEFAULT CURRENT_TIMESTAMP,confirmed_at TEXT,UNIQUE(business_id,file_hash))');
 await run('CREATE TABLE IF NOT EXISTS purchase_bill_items(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL,purchase_bill_id INTEGER NOT NULL,extracted_name TEXT,matched_item_id INTEGER,quantity REAL,unit TEXT DEFAULT "PCS",purchase_price REAL DEFAULT 0,gst_rate REAL DEFAULT 0,hsn_code TEXT DEFAULT "",taxable_value REAL DEFAULT 0,tax_amount REAL DEFAULT 0,line_total REAL DEFAULT 0,is_new_item INTEGER DEFAULT 0)');
 const migrations=[
  ['orders','returned_items','INTEGER DEFAULT 0'],['orders','return_status','TEXT DEFAULT "NONE"'],
  ['orders','returned_items','INTEGER DEFAULT 0'],['orders','return_status','TEXT DEFAULT "NONE"'],
  ['purchase_bills','buyer_name','TEXT DEFAULT ""'],['purchase_bills','buyer_gstin','TEXT DEFAULT ""'],['purchase_bills','buyer_pan','TEXT DEFAULT ""'],['purchase_bills','seller_pan','TEXT DEFAULT ""'],['purchase_bills','seller_phone','TEXT DEFAULT ""'],['purchase_bills','seller_address','TEXT DEFAULT ""'],['purchase_bills','seller_state','TEXT DEFAULT ""'],['purchase_bills','seller_state_code','TEXT DEFAULT ""'],['purchase_bills','seller_id','TEXT DEFAULT ""'],['purchase_bills','buyer_id','TEXT DEFAULT ""'],['purchase_bills','challan_number','TEXT DEFAULT ""'],['purchase_bills','challan_date','TEXT DEFAULT ""'],['purchase_bills','eway_bill_number','TEXT DEFAULT ""'],['purchase_bills','transport','TEXT DEFAULT ""'],['purchase_bills','transport_id','TEXT DEFAULT ""'],['purchase_bills','taxable_total','REAL DEFAULT 0'],['purchase_bills','tax_total','REAL DEFAULT 0'],['purchase_bills','cgst','REAL DEFAULT 0'],['purchase_bills','sgst','REAL DEFAULT 0'],['purchase_bills','igst','REAL DEFAULT 0'],['purchase_bills','invoice_total','REAL DEFAULT 0'],['purchase_bill_items','supplier_sku','TEXT DEFAULT ""']
 ];
 for(const [table,col,type] of migrations){const cols=await all('PRAGMA table_info('+table+')');if(!cols.some(x=>x.name===col))await run('ALTER TABLE '+table+' ADD COLUMN '+col+' '+type)}

 await run('CREATE TABLE IF NOT EXISTS invoices(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL,invoice_no TEXT,financial_year TEXT,customer_id INTEGER,invoice_date TEXT,status TEXT DEFAULT "DRAFT",place_of_supply TEXT DEFAULT "",payment_status TEXT DEFAULT "UNPAID",payment_method TEXT DEFAULT "",paid_amount REAL DEFAULT 0,subtotal REAL DEFAULT 0,cgst REAL DEFAULT 0,sgst REAL DEFAULT 0,igst REAL DEFAULT 0,total REAL DEFAULT 0,UNIQUE(business_id,invoice_no))');
 await run('CREATE TABLE IF NOT EXISTS invoice_items(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL,invoice_id INTEGER,item_id INTEGER,item_name TEXT,quantity REAL,unit TEXT,rate REAL,hsn_code TEXT,gst_rate REAL,taxable_value REAL,total_tax REAL,line_total REAL)');
 await run('CREATE TABLE IF NOT EXISTS audit_logs(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER,user_id INTEGER,action TEXT,entity TEXT,entity_id INTEGER,details TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
 let b=await get('SELECT * FROM businesses ORDER BY id LIMIT 1');
 if(!b){const pw=process.env.DEFAULT_ADMIN_PASSWORD||'ChangeMe123!';const r=await run('INSERT INTO businesses(firm_id,name,password_hash) VALUES(?,?,?)',['DEFAULT','My Business',hashPassword(pw)]);b=await get('SELECT * FROM businesses WHERE id=?',[r.lastID]);await run('INSERT INTO users(business_id,username,role,password_hash) VALUES(?,?,?,?)',[b.id,'owner','OWNER',b.password_hash])}
 const bs=await all('SELECT id FROM businesses'); for(const x of bs)await run('INSERT OR IGNORE INTO whatsapp_sessions(business_id,status) VALUES(?,?)',[x.id,'DISCONNECTED']);
}
const ready=init();
async function register(firmId,name,password){firmId=clean(firmId).toUpperCase().replace(/[^A-Z0-9_-]/g,'');name=clean(name);if(firmId.length<3||name.length<2||String(password).length<8)throw Error('Use a firm ID, business name and password of at least 8 characters.');const r=await run('INSERT INTO businesses(firm_id,name,password_hash) VALUES(?,?,?)',[firmId,name,hashPassword(password)]);const b=await get('SELECT * FROM businesses WHERE id=?',[r.lastID]);await run('INSERT INTO users(business_id,username,role,password_hash) VALUES(?,?,?,?)',[b.id,'owner','OWNER',b.password_hash]);await run('INSERT INTO whatsapp_sessions(business_id,status) VALUES(?,?)',[b.id,'DISCONNECTED']);return {id:b.id,firm_id:b.firm_id,name:b.name}}
async function login(firmId,password){const b=await get('SELECT * FROM businesses WHERE firm_id=?',[clean(firmId).toUpperCase()]);if(!b||!verifyPassword(password,b.password_hash))return null;const u=await get('SELECT * FROM users WHERE business_id=? ORDER BY id LIMIT 1',[b.id]);const t=token(),c=token();await run('INSERT INTO sessions(token_hash,csrf_hash,business_id,user_id,expires_at) VALUES(?,?,?,?,datetime("now","+14 day"))',[sha(t),sha(c),b.id,u?.id||null]);return {token:t,csrf:c,business:{id:b.id,firm_id:b.firm_id,name:b.name,gstin:b.gstin,address:b.address,state:b.state,state_code:b.state_code,phone:b.phone,email:b.email,invoice_prefix:b.invoice_prefix},user:{username:u?.username,role:u?.role}}}
async function session(t){return t?get('SELECT * FROM sessions WHERE token_hash=? AND expires_at>datetime("now")',[sha(t)]):null} async function logout(t){return run('DELETE FROM sessions WHERE token_hash=?',[sha(t)])}
async function business(id){return get('SELECT id,firm_id,name,gstin,address,state,state_code,phone,email,invoice_prefix FROM businesses WHERE id=?',[id])}
async function updateBusiness(id,d){await run('UPDATE businesses SET name=?,gstin=?,address=?,state=?,state_code=?,phone=?,email=?,invoice_prefix=? WHERE id=?',[clean(d.name),clean(d.gstin),clean(d.address),clean(d.state),clean(d.state_code),clean(d.phone),clean(d.email),clean(d.invoice_prefix)||'INV',id]);return business(id)}
async function items(b){return all('SELECT *,CASE WHEN current_stock<=minimum_stock THEN 1 ELSE 0 END low_stock FROM items WHERE business_id=? ORDER BY name',[b])}
async function addItem(b,d){const name=clean(d.name);if(!name)throw Error('Product name required');const opening=Math.max(0,Number(d.opening_stock||0));const r=await run('INSERT INTO items(business_id,name,sku,hsn_code,unit,opening_stock,current_stock,minimum_stock,purchase_price,selling_price,gst_rate) VALUES(?,?,?,?,?,?,?,?,?,?,?)',[b,name,clean(d.sku),clean(d.hsn_code),clean(d.unit)||'PCS',opening,opening,Math.max(0,Number(d.minimum_stock||0)),money(d.purchase_price),money(d.selling_price),money(d.gst_rate)]);if(opening)await run('INSERT INTO stock_transactions(business_id,item_id,type,quantity,reason) VALUES(?,?,"IN",?,?)',[b,r.lastID,opening,'Opening stock']);return get('SELECT * FROM items WHERE id=?',[r.lastID])}
async function editItem(b,id,d){await run('UPDATE items SET name=?,sku=?,hsn_code=?,unit=?,minimum_stock=?,purchase_price=?,selling_price=?,gst_rate=? WHERE business_id=? AND id=?',[clean(d.name),clean(d.sku),clean(d.hsn_code),clean(d.unit)||'PCS',Math.max(0,Number(d.minimum_stock||0)),money(d.purchase_price),money(d.selling_price),money(d.gst_rate),b,id]);return get('SELECT * FROM items WHERE business_id=? AND id=?',[b,id])}
async function stockIn(b,id,q,reason){q=Number(q);if(!(q>0))throw Error('Quantity must be greater than zero');const p=await get('SELECT * FROM items WHERE business_id=? AND id=?',[b,id]);if(!p)throw Error('Product not found');await run('UPDATE items SET current_stock=current_stock+? WHERE business_id=? AND id=?',[q,b,id]);await run('INSERT INTO stock_transactions(business_id,item_id,type,quantity,reason) VALUES(?,?,"IN",?,?)',[b,id,q,clean(reason)||'Manual stock addition']);return get('SELECT * FROM items WHERE id=?',[id])}
async function transactions(b){return all('SELECT s.*,i.name item_name FROM stock_transactions s JOIN items i ON i.id=s.item_id WHERE s.business_id=? ORDER BY s.id DESC LIMIT 500',[b])}
async function senders(b){return all('SELECT * FROM senders WHERE business_id=? ORDER BY id DESC',[b])}
async function addSender(b,p,n){p=normalizePhone(p);if(!p)throw Error('Invalid phone number');if(!clean(n))throw Error('Sender name required');const exists=await get('SELECT id FROM senders WHERE business_id=? AND whatsapp_id=?',[b,p]);if(exists)throw Error('This WhatsApp number is already allowed');const r=await run('INSERT INTO senders(business_id,whatsapp_id,name) VALUES(?,?,?)',[b,p,clean(n)]);return get('SELECT * FROM senders WHERE id=?',[r.lastID])}
async function editSender(b,id,p,n){p=normalizePhone(p);if(!p)throw Error('Invalid phone number');if(!clean(n))throw Error('Sender name required');const exists=await get('SELECT id FROM senders WHERE business_id=? AND whatsapp_id=? AND id<>?',[b,p,id]);if(exists)throw Error('This WhatsApp number is already allowed');const r=await run('UPDATE senders SET whatsapp_id=?,name=? WHERE business_id=? AND id=?',[p,clean(n),b,id]);if(!r.changes)throw Error('Allowed number not found');return get('SELECT * FROM senders WHERE business_id=? AND id=?',[b,id])}
async function delSender(b,id){return run('DELETE FROM senders WHERE business_id=? AND id=?',[b,id])} async function sender(b,p){
  const n=normalizePhone(p);
  if(!n)return null;
  const rows=await all('SELECT * FROM senders WHERE business_id=?',[b]);
  const last10=n.length>=10?n.slice(-10):n;
  return rows.find(x=>{
    const saved=normalizePhone(x.whatsapp_id);
    return saved===n || (saved.length>=10 && saved.slice(-10)===last10);
  })||null;
}
async function lid(b,l){const r=await get('SELECT phone FROM whatsapp_lid_map WHERE business_id=? AND lid=?',[b,l]);return r?.phone||null} async function saveLid(b,l,p){return run('INSERT INTO whatsapp_lid_map(business_id,lid,phone) VALUES(?,?,?) ON CONFLICT(business_id,lid) DO UPDATE SET phone=excluded.phone',[b,l,normalizePhone(p)])}
async function createOrder(o){await run('BEGIN IMMEDIATE');try{const dup=await get('SELECT id FROM orders WHERE business_id=? AND whatsapp_message_id=?',[o.businessId,o.whatsappMessageId]);if(dup){await run('ROLLBACK');return order(o.businessId,dup.id)}const r=await run('INSERT INTO orders(business_id,date,time,delivered_to,sender_id,whatsapp_message_id,whatsapp_from,total_items) VALUES(?,?,?,?,?,?,?,?)',[o.businessId,o.date,o.time,o.deliveredTo,o.senderId,o.whatsappMessageId,o.whatsappFrom,o.items.length]);let a=0,rej=0;for(const x of o.items){const name=clean(x.item),q=Number(x.quantity),p=await get('SELECT * FROM items WHERE business_id=? AND name=? COLLATE NOCASE',[o.businessId,name]);if(!p){rej++;await run('INSERT INTO order_items(business_id,order_id,item_name,requested_quantity,rejected_quantity,status,rejection_reason) VALUES(?,?,?,?,?,?,?)',[o.businessId,r.lastID,name,q,q,'REJECTED','Product not found in stock']);continue}if(!(q>0)){rej++;continue}if(Number(p.current_stock)<q){rej++;await run('INSERT INTO order_items(business_id,order_id,item_id,item_name,requested_quantity,rejected_quantity,status,rejection_reason,unit,rate,hsn_code,gst_rate) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',[o.businessId,r.lastID,p.id,p.name,q,q,'REJECTED','Insufficient stock',p.unit,p.selling_price,p.hsn_code,p.gst_rate]);continue}const taxable=money(q*p.selling_price),tax=money(taxable*p.gst_rate/100);const oi=await run('INSERT INTO order_items(business_id,order_id,item_id,item_name,requested_quantity,accepted_quantity,status,unit,rate,hsn_code,gst_rate,taxable_value,total_tax,line_total) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[o.businessId,r.lastID,p.id,p.name,q,q,'ACCEPTED',p.unit,p.selling_price,p.hsn_code,p.gst_rate,taxable,tax,money(taxable+tax)]);await run('UPDATE items SET current_stock=current_stock-? WHERE business_id=? AND id=?',[q,o.businessId,p.id]);await run('INSERT INTO stock_transactions(business_id,item_id,type,quantity,reason,order_id,order_item_id) VALUES(?,?,"OUT",?,?,?,?)',[o.businessId,p.id,q,'WhatsApp delivery to '+o.deliveredTo,r.lastID,oi.lastID]);a++}const status=a&&rej?'PARTIAL':a?'SUCCESS':'REJECTED';await run('UPDATE orders SET accepted_items=?,rejected_items=?,status=? WHERE id=?',[a,rej,status,r.lastID]);await run('INSERT OR IGNORE INTO processed_messages(business_id,message_id,whatsapp_from,sender_phone,body) VALUES(?,?,?,?,?)',[o.businessId,o.whatsappMessageId,o.whatsappFrom,o.senderPhone,o.body]);await run('COMMIT');return order(o.businessId,r.lastID)}catch(e){await run('ROLLBACK').catch(()=>{});throw e}}
async function orders(b){return all('SELECT o.*,s.name sender_name,s.whatsapp_id sender_phone,COALESCE(o.returned_items,0) returned_items,COALESCE(o.return_status,'NONE') return_status FROM orders o LEFT JOIN senders s ON s.id=o.sender_id WHERE o.business_id=? ORDER BY o.id DESC LIMIT 1000',[b])}
async function order(b,id){const o=await get('SELECT o.*,s.name sender_name,s.whatsapp_id sender_phone,COALESCE(o.returned_items,0) returned_items,COALESCE(o.return_status,'NONE') return_status FROM orders o LEFT JOIN senders s ON s.id=o.sender_id WHERE o.business_id=? AND o.id=?',[b,id]);if(o)o.items=await all('SELECT * FROM order_items WHERE business_id=? AND order_id=?',[b,id]);return o}
async function returnsForOrder(b,id){
  return all('SELECT r.*,COUNT(ri.id) item_lines FROM order_returns r LEFT JOIN order_return_items ri ON ri.return_id=r.id WHERE r.business_id=? AND r.order_id=? GROUP BY r.id ORDER BY r.id DESC',[b,id]);
}
async function createOrderReturn(b,orderId,rows,reason,userId){
  await run('BEGIN IMMEDIATE');
  try{
    const o=await get('SELECT * FROM orders WHERE business_id=? AND id=?',[b,orderId]);
    if(!o)throw Error('Order not found');
    if(!['SUCCESS','PARTIAL','RETURNED','PARTIAL_RETURN'].includes(o.status))throw Error('Only delivered orders can be returned');
    const items=await all('SELECT * FROM order_items WHERE business_id=? AND order_id=? AND accepted_quantity>0',[b,orderId]);
    const prior=await all('SELECT ri.order_item_id,COALESCE(SUM(ri.quantity),0) returned FROM order_return_items ri JOIN order_returns r ON r.id=ri.return_id WHERE ri.business_id=? AND r.order_id=? GROUP BY ri.order_item_id',[b,orderId]);
    const priorMap=new Map(prior.map(x=>[Number(x.order_item_id),Number(x.returned)]));
    let returnedTotal=0;
    for(const row of (Array.isArray(rows)?rows:[])){
      const oi=items.find(x=>Number(x.id)===Number(row.order_item_id));
      if(!oi)throw Error('Invalid order item');
      const available=Number(oi.accepted_quantity)-Number(priorMap.get(Number(oi.id))||0);
      const q=Number(row.quantity);
      if(!(q>0))continue;
      if(q>available)throw Error('Return quantity exceeds delivered quantity for '+oi.item_name+' (remaining '+available+')');
      returnedTotal+=q;
    }
    if(!(returnedTotal>0))throw Error('Enter at least one return quantity');
    const rr=await run('INSERT INTO order_returns(business_id,order_id,reason,created_by) VALUES(?,?,?,?)',[b,orderId,clean(reason),userId||null]);
    for(const row of rows){
      const q=Number(row.quantity);if(!(q>0))continue;
      const oi=items.find(x=>Number(x.id)===Number(row.order_item_id));
      await run('INSERT INTO order_return_items(business_id,return_id,order_item_id,quantity,reason) VALUES(?,?,?,?,?)',[b,rr.lastID,oi.id,q,clean(reason)]);
      await run('UPDATE items SET current_stock=current_stock+? WHERE business_id=? AND id=?',[q,b,oi.item_id]);
      await run('INSERT INTO stock_transactions(business_id,item_id,type,quantity,reason,order_id,order_item_id) VALUES(?,?,"RETURN",?,?,?,?)',[b,oi.item_id,q,'Customer return for order #'+orderId,orderId,oi.id]);
    }
    const totals=await get('SELECT COALESCE(SUM(ri.quantity),0) returned FROM order_return_items ri JOIN order_returns r ON r.id=ri.return_id WHERE ri.business_id=? AND r.order_id=?',[b,orderId]);
    const accepted=Number(o.accepted_items)||0;
    const status=Number(totals.returned)>=accepted?'RETURNED':'PARTIAL_RETURN';
    await run('UPDATE orders SET returned_items=?,return_status=?,status=? WHERE business_id=? AND id=?',[Number(totals.returned)||0,status,status,b,orderId]);
    await run('COMMIT');
    return order(b,orderId);
  }catch(e){await run('ROLLBACK').catch(()=>{});throw e}
}
async function returnsForOrder(b,id){return all('SELECT r.*,COUNT(ri.id) item_lines FROM order_returns r LEFT JOIN order_return_items ri ON ri.return_id=r.id WHERE r.business_id=? AND r.order_id=? GROUP BY r.id ORDER BY r.id DESC',[b,id])}
async function createOrderReturn(b,orderId,rows,reason,userId){
  await run('BEGIN IMMEDIATE');
  try{
    const o=await get('SELECT * FROM orders WHERE business_id=? AND id=?',[b,orderId]); if(!o)throw Error('Order not found');
    if(!['SUCCESS','PARTIAL','PARTIAL_RETURN','RETURNED'].includes(o.status))throw Error('Only delivered orders can be returned');
    const items=await all('SELECT * FROM order_items WHERE business_id=? AND order_id=? AND accepted_quantity>0',[b,orderId]);
    const prior=await all('SELECT ri.order_item_id,COALESCE(SUM(ri.quantity),0) returned FROM order_return_items ri JOIN order_returns r ON r.id=ri.return_id WHERE ri.business_id=? AND r.order_id=? GROUP BY ri.order_item_id',[b,orderId]);
    const pm=new Map(prior.map(x=>[Number(x.order_item_id),Number(x.returned)]));
    let total=0;
    for(const row of (Array.isArray(rows)?rows:[])){
      const oi=items.find(x=>Number(x.id)===Number(row.order_item_id)); if(!oi)throw Error('Invalid order item');
      const available=Number(oi.accepted_quantity)-Number(pm.get(Number(oi.id))||0), q=Number(row.quantity);
      if(!(q>0))continue; if(q>available)throw Error('Return quantity exceeds remaining delivered quantity for '+oi.item_name);
      total+=q;
    }
    if(!(total>0))throw Error('Enter at least one return quantity');
    const rr=await run('INSERT INTO order_returns(business_id,order_id,reason,created_by) VALUES(?,?,?,?)',[b,orderId,clean(reason),userId||null]);
    for(const row of rows){const q=Number(row.quantity);if(!(q>0))continue;const oi=items.find(x=>Number(x.id)===Number(row.order_item_id));await run('INSERT INTO order_return_items(business_id,return_id,order_item_id,quantity,reason) VALUES(?,?,?,?,?)',[b,rr.lastID,oi.id,q,clean(reason)]);await run('UPDATE items SET current_stock=current_stock+? WHERE business_id=? AND id=?',[q,b,oi.item_id]);await run('INSERT INTO stock_transactions(business_id,item_id,type,quantity,reason,order_id,order_item_id) VALUES(?,?,"RETURN",?,?,?,?)',[b,oi.item_id,q,'Customer return for order #'+orderId,orderId,oi.id]);}
    const t=await get('SELECT COALESCE(SUM(ri.quantity),0) returned FROM order_return_items ri JOIN order_returns r ON r.id=ri.return_id WHERE ri.business_id=? AND r.order_id=?',[b,orderId]);
    const status=Number(t.returned)>=Number(o.accepted_items)?'RETURNED':'PARTIAL_RETURN';
    await run('UPDATE orders SET returned_items=?,return_status=?,status=? WHERE business_id=? AND id=?',[Number(t.returned)||0,status,status,b,orderId]);
    await run('COMMIT'); return order(b,orderId);
  }catch(e){await run('ROLLBACK').catch(()=>{});throw e}
}
async function confirmationSent(b,id,msg){await run('UPDATE orders SET confirmation_sent=1,confirmation_message_id=? WHERE business_id=? AND id=?',[msg||'',b,id]);return order(b,id)} async function confirmationPending(b,id){return run('UPDATE orders SET confirmation_sent=0,status="PENDING" WHERE business_id=? AND id=?',[b,id])}
async function customers(b){return all('SELECT * FROM customers WHERE business_id=? ORDER BY name',[b])}
async function findCustomerByName(b,name){return get('SELECT * FROM customers WHERE business_id=? AND name=? COLLATE NOCASE ORDER BY id DESC LIMIT 1',[b,clean(name)])} async function addCustomer(b,d){const r=await run('INSERT INTO customers(business_id,name,phone,address,gstin,email,state,state_code,notes) VALUES(?,?,?,?,?,?,?,?,?)',[b,clean(d.name),normalizePhone(d.phone),clean(d.address),clean(d.gstin),clean(d.email),clean(d.state),clean(d.state_code),clean(d.notes)]);return get('SELECT * FROM customers WHERE id=?',[r.lastID])}
async function invoices(b){return all('SELECT i.*,c.name customer_name FROM invoices i LEFT JOIN customers c ON c.id=i.customer_id WHERE i.business_id=? ORDER BY i.id DESC LIMIT 500',[b])}
async function invoice(b,id){const i=await get('SELECT i.*,c.name customer_name,c.phone customer_phone,c.address customer_address,c.gstin customer_gstin,c.state customer_state,c.state_code customer_state_code FROM invoices i LEFT JOIN customers c ON c.id=i.customer_id WHERE i.business_id=? AND i.id=?',[b,id]);if(i)i.items=await all('SELECT * FROM invoice_items WHERE business_id=? AND invoice_id=?',[b,id]);return i}
async function createInvoice(b,d){if(!Array.isArray(d.items)||!d.items.length)throw Error('Add at least one product');const biz=await business(b),cust=await get('SELECT * FROM customers WHERE business_id=? AND id=?',[b,d.customer_id]);const fy=new Date().getFullYear()+'-'+String(new Date().getFullYear()+1).slice(-2),cnt=await get('SELECT COUNT(*) c FROM invoices WHERE business_id=? AND financial_year=?',[b,fy]);const no=(biz.invoice_prefix||'INV')+'-'+String(Number(cnt.c)+1).padStart(4,'0');let sub=0,cgst=0,sgst=0,igst=0,rows=[];for(const x of d.items){const p=await get('SELECT * FROM items WHERE business_id=? AND id=?',[b,x.item_id]);if(!p)throw Error('Product not found');const q=Number(x.quantity);if(!(q>0))throw Error('Invalid quantity');const tv=money(q*p.selling_price),tx=money(tv*p.gst_rate/100);sub+=tv;const same=!!(biz.state_code&&cust?.state_code&&biz.state_code===cust.state_code);if(same){cgst+=money(tx/2);sgst+=money(tx/2)}else igst+=tx;rows.push({p,q,tv,tx,total:money(tv+tx)})}const total=money(sub+cgst+sgst+igst);const r=await run('INSERT INTO invoices(business_id,invoice_no,financial_year,customer_id,invoice_date,status,place_of_supply,subtotal,cgst,sgst,igst,total) VALUES(?,?,?,?,?,"DRAFT",?,?,?,?,?)',[b,no,fy,cust?.id||null,d.invoice_date||new Date().toISOString().slice(0,10),cust?.state||'',sub,cgst,sgst,igst,total]);for(const x of rows)await run('INSERT INTO invoice_items(business_id,invoice_id,item_id,item_name,quantity,unit,rate,hsn_code,gst_rate,taxable_value,total_tax,line_total) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',[b,r.lastID,x.p.id,x.p.name,x.q,x.p.unit,x.p.selling_price,x.p.hsn_code,x.p.gst_rate,x.tv,x.tx,x.total]);return invoice(b,r.lastID)}
async function finalizeInvoice(b,id){await run('BEGIN IMMEDIATE');try{const i=await invoice(b,id);if(!i||i.status!=='DRAFT')throw Error('Only draft invoices can be finalized');for(const x of i.items){const p=await get('SELECT current_stock FROM items WHERE business_id=? AND id=?',[b,x.item_id]);if(!p||p.current_stock<x.quantity)throw Error('Insufficient stock for '+x.item_name)}for(const x of i.items){await run('UPDATE items SET current_stock=current_stock-? WHERE business_id=? AND id=?',[x.quantity,b,x.item_id]);await run('INSERT INTO stock_transactions(business_id,item_id,type,quantity,reason) VALUES(?,?,"OUT",?,?)',[b,x.item_id,x.quantity,'Invoice '+i.invoice_no])}await run('UPDATE invoices SET status="FINALIZED" WHERE business_id=? AND id=?',[b,id]);await run('COMMIT');return invoice(b,id)}catch(e){await run('ROLLBACK').catch(()=>{});throw e}}
async function cancelInvoice(b,id){await run('BEGIN IMMEDIATE');try{const i=await invoice(b,id);if(!i)throw Error('Invoice not found');if(i.status==='FINALIZED')for(const x of i.items){await run('UPDATE items SET current_stock=current_stock+? WHERE business_id=? AND id=?',[x.quantity,b,x.item_id]);await run('INSERT INTO stock_transactions(business_id,item_id,type,quantity,reason) VALUES(?,?,"REVERSAL",?,?)',[b,x.item_id,x.quantity,'Cancelled '+i.invoice_no])}await run('UPDATE invoices SET status="CANCELLED" WHERE business_id=? AND id=?',[b,id]);await run('COMMIT');return invoice(b,id)}catch(e){await run('ROLLBACK').catch(()=>{});throw e}}
async function purchaseBills(b){return all('SELECT * FROM purchase_bills WHERE business_id=? ORDER BY id DESC LIMIT 200',[b])}
function makeSku(name,hsn=''){
  const base=clean(name).toUpperCase().replace(/[^A-Z0-9]+/g,'').slice(0,10)||'ITEM';
  const h=String(hsn||'').replace(/\D/g,'').slice(0,4);
  return ('SKU-'+base+(h?'-'+h:'')).slice(0,40);
}
async function findPurchaseProduct(b,x){
  const sku=clean(x.sku||x.supplier_sku);
  if(sku){const p=await get('SELECT * FROM items WHERE business_id=? AND sku=? COLLATE NOCASE',[b,sku]);if(p)return p}
  const name=clean(x.name||x.extracted_name);
  if(name){const p=await get('SELECT * FROM items WHERE business_id=? AND name=? COLLATE NOCASE',[b,name]);if(p)return p}
  if(name&&x.hsn_code){const rows=await all('SELECT * FROM items WHERE business_id=? AND hsn_code=?',[b,clean(x.hsn_code)]);const key=name.toLowerCase().replace(/[^a-z0-9]+/g,'');const p=rows.find(r=>r.name.toLowerCase().replace(/[^a-z0-9]+/g,'')===key);if(p)return p}
  return null;
}
async function purchaseBills(b){return all('SELECT * FROM purchase_bills WHERE business_id=? ORDER BY id DESC LIMIT 200',[b])}
async function createPurchase(b,d){
  const r=await run('INSERT INTO purchase_bills(business_id,original_filename,file_type,file_hash,supplier_name,supplier_gstin,supplier_address,invoice_number,invoice_date,place_of_supply,raw_text,buyer_name,buyer_gstin,buyer_pan,seller_pan,seller_phone,seller_address,seller_state,seller_state_code,seller_id,buyer_id,challan_number,challan_date,eway_bill_number,transport,transport_id,taxable_total,tax_total,cgst,sgst,igst,invoice_total) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  [b,d.original_filename,d.file_type,d.file_hash,d.supplier_name||'',d.supplier_gstin||'',d.supplier_address||'',d.invoice_number||'',d.invoice_date||'',d.place_of_supply||'',d.raw_text||'',d.buyer_name||'',d.buyer_gstin||'',d.buyer_pan||'',d.seller_pan||'',d.seller_phone||'',d.seller_address||'',d.seller_state||'',d.seller_state_code||'',d.seller_id||'',d.buyer_id||'',d.challan_number||'',d.challan_date||'',d.eway_bill_number||'',d.transport||'',d.transport_id||'',money(d.taxable_total),money(d.tax_total),money(d.cgst),money(d.sgst),money(d.igst),money(d.invoice_total)]);
  return r.lastID;
}
async function purchase(b,id){const x=await get('SELECT * FROM purchase_bills WHERE business_id=? AND id=?',[b,id]);if(x)x.items=await all('SELECT * FROM purchase_bill_items WHERE business_id=? AND purchase_bill_id=?',[b,id]);return x}
async function addPurchaseItem(b,id,x){
  const p=await findPurchaseProduct(b,x);
  await run('INSERT INTO purchase_bill_items(business_id,purchase_bill_id,extracted_name,matched_item_id,quantity,unit,purchase_price,gst_rate,hsn_code,taxable_value,tax_amount,line_total,is_new_item,supplier_sku) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  [b,id,clean(x.name),p?.id||null,Number(x.quantity||0),clean(x.unit)||'PCS',money(x.purchase_price),money(x.gst_rate),clean(x.hsn_code),money(x.taxable_value),money(x.tax_amount),money(x.line_total),p?0:1,clean(x.supplier_sku||x.sku)]);
}
async function confirmPurchase(b,id,rows){
  await run('BEGIN IMMEDIATE');
  try{
    const pb=await purchase(b,id);
    if(!pb||pb.status==='CONFIRMED')throw Error('Purchase bill is unavailable or already confirmed');
    const extracted=pb.items||[];
    for(let n=0;n<extracted.length;n++){
      const x=rows[n]||extracted[n];
      const q=Number(x.quantity??extracted[n].quantity);
      if(!(q>0))throw Error('Invalid purchase quantity for '+(x.name||extracted[n].extracted_name));
      let p=await findPurchaseProduct(b,x);
      const sku=clean(x.sku||x.supplier_sku||extracted[n].supplier_sku)||makeSku(x.name||extracted[n].extracted_name,x.hsn_code||extracted[n].hsn_code);
      if(!p){
        const r=await run('INSERT INTO items(business_id,name,sku,hsn_code,unit,current_stock,opening_stock,purchase_price,gst_rate) VALUES(?,?,?,?,?,?,?,?,?)',
          [b,clean(x.name||extracted[n].extracted_name),sku,clean(x.hsn_code||extracted[n].hsn_code),clean(x.unit||extracted[n].unit)||'PCS',q,q,money(x.purchase_price??extracted[n].purchase_price),money(x.gst_rate??extracted[n].gst_rate)]);
        p=await get('SELECT * FROM items WHERE id=?',[r.lastID]);
      } else {
        await run('UPDATE items SET current_stock=current_stock+?,purchase_price=?,gst_rate=?,hsn_code=CASE WHEN ?<>"" THEN ? ELSE hsn_code END,unit=?,sku=CASE WHEN (sku IS NULL OR sku="") THEN ? ELSE sku END WHERE business_id=? AND id=?',
          [q,money(x.purchase_price??extracted[n].purchase_price),money(x.gst_rate??extracted[n].gst_rate),clean(x.hsn_code||extracted[n].hsn_code),clean(x.hsn_code||extracted[n].hsn_code),clean(x.unit||extracted[n].unit)||'PCS',sku,b,p.id]);
      }
      await run('UPDATE purchase_bill_items SET matched_item_id=?,is_new_item=0,supplier_sku=? WHERE business_id=? AND purchase_bill_id=? AND id=?',
        [p.id,clean(x.sku||x.supplier_sku||extracted[n].supplier_sku),b,id,extracted[n].id]);
      await run('INSERT INTO stock_transactions(business_id,item_id,type,quantity,reason) VALUES(?,?,"IN",?,?)',[b,p.id,q,'Purchase bill '+(pb.invoice_number||id)]);
    }
    await run('UPDATE purchase_bills SET status="CONFIRMED",confirmed_at=CURRENT_TIMESTAMP WHERE business_id=? AND id=?',[b,id]);
    await run('COMMIT');
    return purchase(b,id);
  }catch(e){await run('ROLLBACK').catch(()=>{});throw e}
}
async function dashboard(b){const one=async(s)=>Number((await get(s,[b]))?.c||0);return {orders:await one('SELECT COUNT(*) c FROM orders WHERE business_id=?'),products:await one('SELECT COUNT(*) c FROM items WHERE business_id=?'),lowStock:await one('SELECT COUNT(*) c FROM items WHERE business_id=? AND current_stock<=minimum_stock'),todayOrders:await one('SELECT COUNT(*) c FROM orders WHERE business_id=? AND date=date("now","localtime")'),pending:await one('SELECT COUNT(*) c FROM orders WHERE business_id=? AND status="PENDING"'),invoices:await one('SELECT COUNT(*) c FROM invoices WHERE business_id=?'),purchases:await one('SELECT COUNT(*) c FROM purchase_bills WHERE business_id=?'),stockValue:money((await get('SELECT COALESCE(SUM(current_stock*purchase_price),0) v FROM items WHERE business_id=?',[b]))?.v)}}
async function waStatus(b){return get('SELECT * FROM whatsapp_sessions WHERE business_id=?',[b])} async function setWa(b,s,m,q){return run('INSERT INTO whatsapp_sessions(business_id,status,message,qr,updated_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(business_id) DO UPDATE SET status=excluded.status,message=excluded.message,qr=excluded.qr,updated_at=CURRENT_TIMESTAMP',[b,s,m||'',q||null])}
async function audit(b,u,a,e,id,d){return run('INSERT INTO audit_logs(business_id,user_id,action,entity,entity_id,details) VALUES(?,?,?,?,?,?)',[b,u,a,e,id,d||''])}
module.exports={get,all,run,ready,register,login,session,logout,business,updateBusiness,items,addItem,editItem,stockIn,transactions,senders,addSender,delSender,sender,lid,saveLid,createOrder,orders,order,confirmationSent,confirmationPending,returnsForOrder,createOrderReturn,customers,addCustomer,findCustomerByName,invoices,invoice,createInvoice,finalizeInvoice,cancelInvoice,purchaseBills,createPurchase,purchase,addPurchaseItem,confirmPurchase,makeSku,dashboard,waStatus,setWa,audit,normalizePhone};