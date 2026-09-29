const qrcode=require('qrcode');

(async()=>{
  const total=100;
  const started=Date.now();
  for(let i=1;i<=total;i++){
    const payload='whatsapp-qr-test-'+i+'-'+Date.now();
    const data=await qrcode.toDataURL(payload,{width:360,margin:1,errorCorrectionLevel:'M'});
    if(!data.startsWith('data:image/png;base64,'))throw new Error('QR '+i+' did not produce a PNG data URL');
    if(data.length<1000)throw new Error('QR '+i+' output is unexpectedly small');
  }
  console.log('QR STRESS TEST PASSED: '+total+' QR codes generated in '+(Date.now()-started)+'ms');
})().catch(e=>{console.error('QR STRESS TEST FAILED:',e);process.exit(1)});
