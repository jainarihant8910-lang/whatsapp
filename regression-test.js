const fs=require('fs');const path=require('path');const {spawnSync}=require('child_process');
const root=__dirname;const read=f=>fs.readFileSync(path.join(root,f),'utf8');
for(const f of ['index.js','server.js','platform-db.js','public/app.js']){
  const r=spawnSync(process.execPath,['--check',path.join(root,f)],{encoding:'utf8'});
  if(r.status!==0)throw new Error('Syntax failed: '+f+'\n'+r.stderr);
}
const index=read('index.js'),server=read('server.js'),app=read('public/app.js'),db=read('platform-db.js');
for(const forbidden of ['.wwebjs_auth_backup','.wwebjs_cache_backup','workspace_contents']){
  if(fs.existsSync(path.join(root,forbidden)))throw new Error('Runtime artifact must not be present: '+forbidden);
}
if(!server.includes("async function ocrSpaceOcr(buf,mimeType='image/png',engine="))throw new Error('OCR engine selection is not explicit');
if(!server.includes("form.append('OCREngine',String(engine))"))throw new Error('OCR engine parameter is not forwarded');
const checks=[
 [index.includes('inFlightMessageIds'),'Missing in-flight duplicate guard'],
 [index.includes('claimProcessedMessage'),'Missing persistent message claim'],
 [index.includes('const isStockQuery'),'Bare stock query is missing'],
 [index.includes('products.length'),'All-products stock reply is missing'],
 [index.includes('client.sendMessage(from, reply'),'Stock reply send path is missing'],
 [server.includes("app.delete('/api/items/:id'"),'Zero-stock delete API is missing'],
 [db.includes('Number(item.current_stock)!==0'),'Delete zero-stock guard is missing'],
 [db.includes('LEFT JOIN items i ON i.business_id=s.business_id AND i.id=s.item_id'),'Deleted products are preserved in stock history'],
 [app.includes('Number(x.current_stock)===0'),'Delete button is not restricted to zero stock']
];
for(const [ok,msg] of checks)if(!ok)throw new Error(msg);
console.log('Regression checks passed.');
