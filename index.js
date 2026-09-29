require('dotenv').config();
const {Client,LocalAuth}=require('whatsapp-web.js'); const qrcode=require('qrcode'); const db=require('./platform-db'); const path=require('path'); const fs=require('fs'); const {execFileSync}=require('child_process'); const fs=require('fs'); const {execFileSync}=require('child_process');
const clients=new Map(); const starting=new Set();
const AUTH_ROOT=path.join(__dirname,'.wwebjs_auth');
function profilePath(bid){return path.join(AUTH_ROOT,'session-business-'+bid)}
function clearChromiumLocks(bid){
  const profile=profilePath(bid);
  if(!fs.existsSync(profile))return;
  try{
    const ps=execFileSync('ps',['-eo','pid=,args='],{encoding:'utf8'});
    const pids=ps.split('\n').map(x=>x.trim()).filter(Boolean)
      .filter(x=>x.includes('--user-data-dir='+profile)||x.includes('--user-data-dir="'+profile+'"'))
      .map(x=>Number(x.split(/\s+/)[0])).filter(Number.isInteger).filter(x=>x>1);
    for(const pid of pids){try{process.kill(pid,'SIGTERM')}catch{}}
    if(pids.length){
      try{execFileSync('sleep',['0.5'])}catch{}
      for(const pid of pids){try{process.kill(pid,'SIGKILL')}catch{}}
    }
  }catch{}
  for(const name of ['SingletonLock','SingletonSocket','SingletonCookie']){
    try{fs.rmSync(path.join(profile,name),{force:true,recursive:true})}catch{}
  }
}
const AUTH_ROOT=path.join(__dirname,'.wwebjs_auth');
function profilePath(bid){return path.join(AUTH_ROOT,'session-business-'+bid)}
function clearChromiumLocks(bid){
  const profile=profilePath(bid); if(!fs.existsSync(profile))return;
  const exact=profile.replace(/[.*+?^${}()|[\]\\]/g,'\\const clients=new Map(); const starting=new Set();');
  try{
    const ps=execFileSync('ps',['-eo','pid=,args='],{encoding:'utf8'});
    const pids=ps.split('\n').map(x=>x.trim()).filter(Boolean).filter(x=>x.includes('--user-data-dir='+profile)||x.includes('--user-data-dir="'+profile+'"')).map(x=>Number(x.split(/\s+/)[0])).filter(Number.isInteger&&Number>1);
    for(const pid of pids){try{process.kill(pid,'SIGTERM')}catch{}}
    if(pids.length){const until=Date.now()+3000;while(Date.now()<until){let alive=false;for(const pid of pids){try{process.kill(pid,0);alive=true}catch{}}if(!alive)break;require('child_process').execFileSync('sleep',['0.1'])}}
  }catch{}
  for(const name of ['SingletonLock','SingletonSocket','SingletonCookie']){try{fs.rmSync(path.join(profile,name),{force:true,recursive:true})}catch{}}
}
function now(){const d=new Date();const f=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'});const t=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});return {date:f.format(d),time:t.format(d)}}
function parse(body){const lines=String(body||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(lines.length<2)return null;const items=[];for(const l of lines.slice(1)){const m=l.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);if(m)items.push({quantity:Number(m[1]),item:m[2].trim()})}return items.length?{deliveredTo:lines[0],items}:null}
async function phone(message,client,bid){const from=String(message.from||'');if(!from||from.endsWith('@g.us'))return null;if(from.endsWith('@c.us'))return db.normalizePhone(from.replace('@c.us',''));if(from.endsWith('@lid')){const lid=from.replace('@lid','');const old=await db.lid(bid,lid);if(old)return old;try{const c=await message.getContact();const p=db.normalizePhone(c?.number||c?.id?.user||'');if(p){await db.saveLid(bid,lid,p);return p}}catch{}try{const x=await client.getContactLidAndPhone([from]);const p=db.normalizePhone(x?.[0]?.pn||x?.[0]?.phone||'');if(p){await db.saveLid(bid,lid,p);return p}}catch{}return null}return null}
async function startBusiness(bid,force=false){await db.ready;if(starting.has(bid)&&!force)return;if(clients.has(bid)&&!force)return;starting.add(bid);if(force&&clients.has(bid)){try{await clients.get(bid).destroy()}catch{}clients.delete(bid)}await db.setWa(bid,'STARTING','Starting WhatsApp…',null);const client=new Client({authStrategy:new LocalAuth({clientId:'business-'+bid,dataPath:path.join(__dirname,'.wwebjs_auth')}),puppeteer:{args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote'],protocolTimeout:120000},qrMaxRetries:5});clients.set(bid,client);client.on('qr',async qr=>{try{const data=await qrcode.toDataURL(qr,{width:300,margin:1});await db.setWa(bid,'WAITING_FOR_QR','Scan the QR code with WhatsApp.',data)}catch(e){await db.setWa(bid,'ERROR',e.message,null)}});client.on('authenticated',()=>db.setWa(bid,'AUTHENTICATED','WhatsApp authenticated.',null));client.on('ready',()=>{starting.delete(bid);db.setWa(bid,'CONNECTED','WhatsApp is connected.',null);console.log('WhatsApp ready for business',bid)});client.on('auth_failure',m=>db.setWa(bid,'AUTH_FAILURE',String(m),null));client.on('change_state',st=>{if(st!=='CONNECTED')db.setWa(bid,'DISCONNECTED','WhatsApp state: '+st,null)});client.on('disconnected',async reason=>{clients.delete(bid);starting.delete(bid);await db.setWa(bid,'DISCONNECTED','Disconnected: '+reason,null);setTimeout(()=>startBusiness(bid).catch(console.error),5000)});client.on('message',async message=>{try{if(message.fromMe)return;const p=parse(message.body);if(!p)return;const senderPhone=await phone(message,client,bid);if(!senderPhone)return;const allowed=await db.sender(bid,senderPhone);if(!allowed)return;const id=message.id?._serialized||message.id?.id;if(!id)return;const o=await db.createOrder({businessId:bid,date:now().date,time:now().time,deliveredTo:p.deliveredTo,senderId:allowed.id,whatsappMessageId:id,whatsappFrom:message.from,body:message.body,senderPhone,items:p.items});if(o.confirmation_sent)return;const reply='Order #'+o.id+' '+(o.status==='SUCCESS'?'accepted successfully.':o.status==='PARTIAL'?'partially accepted.':'could not be fulfilled.')+' Accepted: '+o.accepted_items+' item(s). Rejected: '+o.rejected_items+' item(s).';try{const sent=await message.reply(reply);await db.confirmationSent(bid,o.id,sent?.id?._serialized||'')}catch(e){await db.confirmationPending(bid,o.id);console.error('Confirmation failed',e.message)}}catch(e){console.error('WhatsApp message error',e)}});let retried=false;
  const initialize=async()=>{try{await client.initialize();}catch(e){
    const msg=String(e?.message||e); const conflict=/already running|userDataDir|user data directory|Singleton/i.test(msg);
    if(conflict&&!retried){retried=true;console.warn('WhatsApp browser profile is locked; cleaning the stale browser session and retrying.');try{await client.destroy()}catch{}clients.delete(bid);clearChromiumLocks(bid);await db.setWa(bid,'STARTING','Restarting WhatsApp browser…',null);return startBusiness(bid,true);}
    starting.delete(bid);await db.setWa(bid,'ERROR',msg,null);console.error('WhatsApp initialization failed for business',bid,msg);
  }};
  initialize();
}
async function startAll(){await db.ready;const rows=await db.all('SELECT id FROM businesses');for(const b of rows)startBusiness(b.id).catch(console.error)}
module.exports={startBusiness,startAll,clients};
if(require.main===module)startAll();