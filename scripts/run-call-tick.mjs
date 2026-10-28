// Coolify scheduled command, inside the Atlas container. No keys in command lines or logs.
const token=process.env.ASK865_CALLS_INGEST_TOKEN;
if(process.env.ASK865_CALLS_SCHEDULER_ENABLED!=="true"){console.log(JSON.stringify({status:"disabled"}));process.exit(0);}
if(!token||token.length<32){console.log(JSON.stringify({status:"configuration_required"}));process.exit(1);}
try {
 const response=await fetch("http://127.0.0.1:3000/api/ask865/calls/tick",{method:"POST",headers:{Authorization:`Bearer ${token}`},redirect:"error",signal:AbortSignal.timeout(590000)});
 const result=await response.json();
 console.log(JSON.stringify({ok:response.ok,status:result.status??"failed",discoveryWindows:result.discoveryWindows??null,processingStatus:result.processing?.status??null}));
 if(!response.ok)process.exitCode=1;
}catch { console.log(JSON.stringify({status:"worker_unavailable"}));process.exitCode=1; }
