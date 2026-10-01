const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const db=require('./platform-db');
const BACKUP_DIR=path.join(__dirname,'data','backups');
fs.mkdirSync(BACKUP_DIR,{recursive:true});
const clean=v=>String(v??'').trim().slice(0,500);
const money=v=>Math.round((Number(v)||0)*100)/100;
const todayIndia=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const roleAllowed=(r)=>['OWNER','ADMIN'].includes(String(r||'').toUpperCase());
const hashImport=t=>crypto.createHash('sha256').update(String(t).replace(/\r/g,'').trim()).digest('hex');
const importId=t=>'GST-'+hashImport(t).slice(0,12).toUpperCase();

async function setup(){
 await db.ready;
 await db.run('CREATE TABLE IF NOT EXISTS gst_update_imports(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL,import_id TEXT NOT NULL,content_hash TEXT NOT NULL,effective_from TEXT NOT NULL,status TEXT NOT NULL DEFAULT "APPLIED",row_count INTEGER DEFAULT 0,created_by INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP,applied_at TEXT,UNIQUE(business_id,content_hash))');
 await db.run('CREATE TABLE IF NOT EXISTS gst_rate_schedules(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL,import_id TEXT NOT NULL,hsn_code TEXT NOT NULL,product_name TEXT NOT NULL,new_rate REAL NOT NULL,effective_from TEXT NOT NULL,status TEXT NOT NULL DEFAULT "SCHEDULED",created_by INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP,activated_at TEXT,UNIQUE(business_id,import_id,hsn_code))');
}
function parse(text){
 const lines=String(text||'').replace(/\r/g,'').split('\n').map(x=>x.trim()).filter(Boolean);
 if(!lines.length||!/^GST_UPDATE$/i.test(lines[0]))throw Error('File must start with GST_UPDATE.');
 let effective='',header=false,ended=false,rows=[];
 for(let i=1;i<lines.length;i++){
  const line=lines[i]; if(line.startsWith('#'))continue;
  const em=line.match(/^EFFECTIVE_FROM\s*:\s*(\d{4}-\d{2}-\d{2})$/i); if(em){effective=em[1];continue}
  if(/^END$/i.test(line)){ended=true;break}
  if(/^HSN\s*\|\s*PRODUCT\s*\|\s*OLD_RATE\s*\|\s*NEW_RATE$/i.test(line)){header=true;continue}
  if(!header)throw Error('Missing HSN|PRODUCT|OLD_RATE|NEW_RATE header.');
  const p=line.split('|').map(x=>x.trim());
  if(p.length!==4)throw Error('Invalid row: '+line+' — use HSN|PRODUCT|OLD_RATE|NEW_RATE.');
  if(!/^\d{4,8}$/.test(p[0]))throw Error('Invalid HSN '+p[0]+'. HSN must contain 4 to 8 digits.');
  if(!p[1])throw Error('Missing PRODUCT name for HSN '+p[0]);
  const oldRate=Number(p[2]),newRate=Number(p[3]);
  if(!Number.isFinite(oldRate)||oldRate<0||oldRate>100)throw Error('Invalid OLD_RATE for HSN '+p[0]);
  if(!Number.isFinite(newRate)||newRate<0||newRate>100)throw Error('Invalid NEW_RATE for HSN '+p[0]);
  rows.push({hsn_code:p[0],product_name:p[1],old_rate:oldRate,new_rate:newRate,line:i+1});
 }
 if(!/^\d{4}-\d{2}-\d{2}$/.test(effective)||Number.isNaN(Date.parse(effective+'T00:00:00Z')))throw Error('Invalid EFFECTIVE_FROM date.');
 if(!header)throw Error('Missing HSN|PRODUCT|OLD_RATE|NEW_RATE header.');
 if(!ended)throw Error('Missing END at the bottom of the file.');
 if(!rows.length)throw Error('No GST rows found.');
 const seen=new Set(); for(const x of rows){if(seen.has(x.hsn_code))throw Error('Duplicate HSN '+x.hsn_code+'. Keep one row per HSN.');seen.add(x.hsn_code)}
 return {effective,rows};
}
async function preview(b,text){
 const parsed=parse(text),out=[];
 for(const x of parsed.rows){
  const master=await db.get('SELECT * FROM hsn_master WHERE business_id=? AND code=?',[b,x.hsn_code]);
  const products=await db.all('SELECT id,name,sku,gst_rate FROM items WHERE business_id=? AND hsn_code=? ORDER BY name',[b,x.hsn_code]);
  const rates=[...new Set(products.map(p=>money(p.gst_rate)))];
  const current=master?money(master.gst_rate):(rates.length===1?rates[0]:null);
  const productMatch=products.length>0&&products.some(p=>String(p.name).trim().toLowerCase()===x.product_name.trim().toLowerCase());
  const multipleRates=rates.length>1|| (!!master&&products.some(p=>money(p.gst_rate)!==money(master.gst_rate)));
  const oldRateMatch=current!==null&&money(current)===money(x.old_rate);
  out.push({...x,current_rate:current,master_found:!!master,product_count:products.length,products,product_match:productMatch,old_rate_match:oldRateMatch,multiple_current_rates:multipleRates,changed:current===null||money(current)!==money(x.new_rate),blocked:!productMatch||!oldRateMatch||multipleRates});
 }
 const h=hashImport(text),existing=await db.get('SELECT status FROM gst_update_imports WHERE business_id=? AND content_hash=?',[b,h]);
 return {import_id:importId(text),effective_from:parsed.effective,rows:out,changes:out.filter(x=>x.changed).length,can_apply:out.length>0&&out.every(x=>!x.blocked),already_imported:!!existing,existing_status:existing?.status||null};
}
async function backup(b,reason='manual'){
 const source=path.join(__dirname,'data','platform.db'); if(!fs.existsSync(source))throw Error('Database file not found.');
 const biz=await db.business(b),stamp=new Date().toISOString().replace(/[:.]/g,'-');
 const safe=String(biz?.firm_id||b).replace(/[^A-Za-z0-9_-]/g,'_');
 const target=path.join(BACKUP_DIR,safe+'-'+stamp+'-'+clean(reason).replace(/[^A-Za-z0-9_-]/g,'_')+'.db');
 fs.copyFileSync(source,target); const st=fs.statSync(target); return {file:path.basename(target),path:target,size:st.size,created_at:new Date().toISOString()};
}
async function apply(b,text,userId){
 const p=await preview(b,text); if(!p.can_apply)throw Error('GST update blocked. Fix every HSN/product/old-rate mismatch before applying.');
 if(p.already_imported)throw Error('This exact GST update has already been imported. Import ID: '+p.import_id);
 const u=await db.get('SELECT role FROM users WHERE business_id=? AND id=?',[b,userId]); if(!roleAllowed(u?.role))throw Error('Only an Owner or Admin can apply GST updates.');
 const parsed=parse(text),hash=hashImport(text),future=parsed.effective>todayIndia(),bk=await backup(b,'gst-'+p.import_id);
 await db.run('BEGIN IMMEDIATE');
 try{
  await db.run('INSERT INTO gst_update_imports(business_id,import_id,content_hash,effective_from,status,row_count,created_by,applied_at) VALUES(?,?,?,?,?,?,?,?)',[b,p.import_id,hash,parsed.effective,future?'SCHEDULED':'APPLIED',parsed.rows.length,userId,future?null:new Date().toISOString()]);
  for(const x of parsed.rows){
   if(future){
    await db.run('INSERT INTO gst_rate_schedules(business_id,import_id,hsn_code,product_name,new_rate,effective_from,status,created_by) VALUES(?,?,?,?,?,?,?,?)',[b,p.import_id,x.hsn_code,x.product_name,x.new_rate,parsed.effective,'SCHEDULED',userId]);
   }else{
    await db.run('INSERT INTO hsn_master(business_id,code,description,gst_rate,active) VALUES(?,?,?,?,1) ON CONFLICT(business_id,code) DO UPDATE SET gst_rate=excluded.gst_rate,active=1',[b,x.hsn_code,x.product_name,x.new_rate]);
    await db.run('UPDATE items SET gst_rate=? WHERE business_id=? AND hsn_code=? AND LOWER(TRIM(name))=LOWER(TRIM(?))',[x.new_rate,b,x.hsn_code,x.product_name]);
    if(money(x.old_rate)!==money(x.new_rate))await db.run('INSERT INTO gst_rate_history(business_id,hsn_code,product_name,old_rate,new_rate,effective_from,source) VALUES(?,?,?,?,?,?,?)',[b,x.hsn_code,x.product_name,x.old_rate,x.new_rate,parsed.effective,'TEMPLATE']);
   }
  }
  await db.audit(b,userId,'GST_UPDATE_'+(future?'SCHEDULED':'APPLIED'),'GST_RATE',null,JSON.stringify({import_id:p.import_id,effective_from:parsed.effective,rows:parsed.rows.length,backup:bk.file}));
  await db.run('COMMIT'); return {...p,backup:bk,status:future?'SCHEDULED':'APPLIED'};
 }catch(e){await db.run('ROLLBACK').catch(()=>{});throw e}
}
async function activateDue(){
 const rows=await db.all('SELECT * FROM gst_rate_schedules WHERE status="SCHEDULED" AND effective_from<=? ORDER BY id',[todayIndia()]);
 for(const x of rows)try{
  await backup(x.business_id,'gst-activate-'+x.import_id); await db.run('BEGIN IMMEDIATE');
  const master=await db.get('SELECT gst_rate FROM hsn_master WHERE business_id=? AND code=?',[x.business_id,x.hsn_code]);
  await db.run('UPDATE items SET gst_rate=? WHERE business_id=? AND hsn_code=? AND LOWER(TRIM(name))=LOWER(TRIM(?))',[x.new_rate,x.business_id,x.hsn_code,x.product_name]);
  await db.run('UPDATE hsn_master SET gst_rate=? WHERE business_id=? AND code=?',[x.new_rate,x.business_id,x.hsn_code]);
  await db.run('INSERT INTO gst_rate_history(business_id,hsn_code,product_name,old_rate,new_rate,effective_from,source) VALUES(?,?,?,?,?,?,?)',[x.business_id,x.hsn_code,x.product_name,master?master.gst_rate:x.new_rate,x.new_rate,x.effective_from,'SCHEDULED']);
  await db.run('UPDATE gst_rate_schedules SET status="ACTIVATED",activated_at=CURRENT_TIMESTAMP WHERE id=?',[x.id]);
  await db.run('UPDATE gst_update_imports SET status="ACTIVATED",applied_at=CURRENT_TIMESTAMP WHERE business_id=? AND import_id=?',[x.business_id,x.import_id]);
  await db.audit(x.business_id,x.created_by,'GST_UPDATE_ACTIVATED','GST_RATE',x.id,JSON.stringify({import_id:x.import_id,effective_from:x.effective_from}));
  await db.run('COMMIT');
 }catch(e){await db.run('ROLLBACK').catch(()=>{});console.error('GST schedule activation failed',x.id,e.message)}
}
(async()=>{
 await setup();
 db.gstUpdatePreview=preview; db.applyGstUpdate=apply;
 const app=require('./server');
 app.get('/api/security/audit',async(r,s)=>{try{s.json({logs:await db.all('SELECT a.*,u.username,u.role FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE a.business_id=? ORDER BY a.id DESC LIMIT 500',[r.businessId])})}catch(e){s.status(500).json({error:e.message})}});
 app.get('/api/security/users',async(r,s)=>{try{s.json({users:await db.all('SELECT id,username,role FROM users WHERE business_id=? ORDER BY id',[r.businessId])})}catch(e){s.status(500).json({error:e.message})}});
 app.post('/api/security/users',async(r,s)=>{try{const me=await db.get('SELECT role FROM users WHERE business_id=? AND id=?',[r.businessId,r.userId]);if(!roleAllowed(me?.role))return s.status(403).json({error:'Only Owner/Admin can manage users.'});const username=clean(r.body.username).toLowerCase(),password=String(r.body.password||''),role=String(r.body.role||'STAFF').toUpperCase();if(!/^[a-z0-9._-]{3,40}$/.test(username))throw Error('Invalid username.');if(password.length<8)throw Error('Password must be at least 8 characters.');if(!['ADMIN','MANAGER','STAFF','VIEWER'].includes(role))throw Error('Invalid role.');const salt=crypto.randomBytes(16).toString('hex'),h=crypto.pbkdf2Sync(password,salt,210000,32,'sha256').toString('hex');const x=await db.run('INSERT INTO users(business_id,username,role,password_hash) VALUES(?,?,?,?)',[r.businessId,username,role,'pbkdf2$210000$'+salt+'$'+h]);await db.audit(r.businessId,r.userId,'USER_CREATED','USER',x.lastID,JSON.stringify({username,role}));s.status(201).json({success:true,id:x.lastID,username,role})}catch(e){s.status(400).json({error:e.message})}});
 app.get('/api/security/backup',async(r,s)=>{try{const me=await db.get('SELECT role FROM users WHERE business_id=? AND id=?',[r.businessId,r.userId]);if(!roleAllowed(me?.role))return s.status(403).json({error:'Only Owner/Admin can create backups.'});const b=await backup(r.businessId,'manual');await db.audit(r.businessId,r.userId,'BACKUP_CREATED','BACKUP',null,JSON.stringify(b));s.download(b.path,b.file)}catch(e){s.status(400).json({error:e.message})}});
 app.get('/api/security/backup-list',async(r,s)=>{try{const biz=await db.business(r.businessId),prefix=String(biz?.firm_id||r.businessId).replace(/[^A-Za-z0-9_-]/g,'_')+'-';const files=fs.readdirSync(BACKUP_DIR).filter(x=>x.startsWith(prefix)).map(x=>{const st=fs.statSync(path.join(BACKUP_DIR,x));return {file:x,size:st.size,created_at:st.mtime.toISOString()}}).sort((a,b)=>b.created_at.localeCompare(a.created_at));s.json({files})}catch(e){s.status(500).json({error:e.message})}});
 app.get('/api/security/gst-schedules',async(r,s)=>s.json({schedules:await db.all('SELECT * FROM gst_rate_schedules WHERE business_id=? ORDER BY effective_from,id',[r.businessId])}));
 await activateDue(); setInterval(()=>activateDue().catch(e=>console.error('GST scheduler:',e.message)),60000).unref();
 console.log('DeliveryOS security layer loaded');
})().catch(e=>{console.error('Security bootstrap failed:',e);process.exit(1)});
