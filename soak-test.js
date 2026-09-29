const http=require('http');
const {spawn}=require('child_process');
const {parseBill}=require('./purchase-parser');
const sample='Sr. No. Name of Product / Service HSN / SAC Qty Rate Taxable Value IGST Total % Amount 1 Bosch All-in-One Metal Hand Tool Kit 8302 1 NOS 2,535.00 2,535.00 18.00 456.30 2,991.30 2 Taparia Universal Tool Kit 8302 1 NOS 1,270.00 1,270.00 18.00 228.60 1,498.60 Total 2 NOS 3,805.00 684.90 4,489.90 Total Amount After Tax ₹4,490.00';
const parsed=parseBill(sample);if(parsed.items.length!==2||parsed.invoice_total!==4490)throw new Error('Purchase parser soak precheck failed');
const port=Number(process.env.SOAK_PORT||3187);const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(port),WHATSAPP_START_ALL:'false',NODE_ENV:'test'},stdio:'inherit'});
const started=Date.now();const duration=6*60*1000;let checks=0;
function health(){return new Promise((resolve,reject)=>{const req=http.get({hostname:'127.0.0.1',port,path:'/api/health',timeout:5000},res=>{let b='';res.on('data',x=>b+=x);res.on('end',()=>res.statusCode===200&&JSON.parse(b).ok?resolve():reject(new Error('health '+res.statusCode+' '+b)))});req.on('error',reject);req.on('timeout',()=>{req.destroy(new Error('health timeout'))})})}
(async()=>{try{while(Date.now()-started<duration){await new Promise(r=>setTimeout(r,5000));await health();checks++;if(checks%12===0)console.log('SOAK',Math.round((Date.now()-started)/1000)+'s','health checks',checks)}console.log('SOAK TEST PASSED: 6 minutes, '+checks+' health checks, purchase parser verified');}catch(e){console.error('SOAK TEST FAILED:',e);process.exitCode=1}finally{child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),3000)}})();
