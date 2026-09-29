const {fork}=require("child_process");
const children=[fork("server.js",{stdio:"inherit"}),fork("index.js",{stdio:"inherit"})];
const shutdown=()=>{for(const c of children)try{c.kill("SIGTERM")}catch{};setTimeout(()=>process.exit(0),500);};
process.on("SIGINT",shutdown);process.on("SIGTERM",shutdown);
for(const c of children)c.on("exit",code=>{if(code&&code!==0)console.error("Worker exited with code",code);});
