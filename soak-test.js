const http=require('http');
const {spawn}=require('child_process');

const port=Number(process.env.SOAK_PORT||3187);
const duration=Number(process.env.SOAK_DURATION_MS||6*60*1000);
const child=spawn(process.execPath,['server.js'],{
  env:{...process.env,PORT:String(port),WHATSAPP_START_ALL:'false',NODE_ENV:'test'},
  stdio:'inherit'
});
const started=Date.now();let checks=0;
function health(){
  return new Promise((resolve,reject)=>{
    const req=http.get({hostname:'127.0.0.1',port,path:'/api/health',timeout:5000},res=>{
      let b='';res.on('data',x=>b+=x);res.on('end',()=>{
        try{
          const json=JSON.parse(b);
          if(res.statusCode===200&&json.ok)return resolve();
          reject(new Error('health '+res.statusCode+' '+b));
        }catch(e){reject(e)}
      });
    });
    req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('health timeout')));
  });
}
(async()=>{
  try{
    await new Promise(r=>setTimeout(r,1000));
    while(Date.now()-started<duration){
      await health();checks++;
      await new Promise(r=>setTimeout(r,5000));
      if(checks%12===0)console.log('SOAK',Math.round((Date.now()-started)/1000)+'s','health checks',checks);
    }
    await health();checks++;
    console.log('SOAK TEST PASSED: '+Math.round(duration/1000)+' seconds, '+checks+' health checks');
  }catch(e){
    console.error('SOAK TEST FAILED:',e);
    process.exitCode=1;
  }finally{
    child.kill('SIGTERM');
    setTimeout(()=>child.kill('SIGKILL'),3000);
  }
})();