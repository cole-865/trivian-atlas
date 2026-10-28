import test from "node:test";
import assert from "node:assert/strict";
import { screenCallPurpose,earlyExclusion } from "../src/lib/ask865/calls/purpose.js";
import { categories } from "../src/lib/ask865/calls/domain.js";
const purpose={category:"vendor" as const,confidence:0.99,clearPurpose:true,customerBusinessPresent:false,criticalConcern:false};
test("early exclusion is limited to confident excluded business purposes",()=>{
 for(const category of categories) assert.equal(earlyExclusion({...purpose,category},0.8),["sales","service","mixed","unknown"].includes(category)?null:category);
 assert.equal(earlyExclusion(purpose,1),null);
 for(const change of [{confidence:0.94},{clearPurpose:false},{customerBusinessPresent:true},{criticalConcern:true}])assert.equal(earlyExclusion({...purpose,...change},0.8),null);
 assert.throws(()=>earlyExclusion(purpose,NaN));
});
test("screening stores no provider response and returns only bounded purpose fields",async()=>{
 const raw={segments:[{speaker:"A",start:0,end:5,text:"A supplier calling test@example.com about delivery."}]};let body: {store:boolean;input:string;text:{format:{strict:boolean}}} | undefined;
 const send=(async (_url,init)=>{body=JSON.parse(String(init?.body));return Response.json({status:"completed",output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(purpose)}]}]});}) as typeof fetch;
 assert.deepEqual(await screenCallPurpose(raw,10,{apiKey:"test",model:"configured"},send),purpose);
 assert.ok(body);assert.equal(body.store,false);assert.ok(!body.input.includes("test@example.com"));assert.equal(body.text.format.strict,true);
});
test("truncated, refused and text-leaking screening output fails closed",async()=>{
 const raw={segments:[{speaker:"A",start:0,end:5,text:"Hello"}]};
 for(const output of [{status:"incomplete",output:[]},{status:"completed",output:[{type:"message",content:[{type:"refusal"}]}]},
 {status:"completed",output:[{type:"message",content:[{type:"output_text",text:JSON.stringify({...purpose,summary:"private text"})}]}]}]) {
  await assert.rejects(screenCallPurpose(raw,10,{apiKey:"test",model:"configured"},(async()=>Response.json(output)) as typeof fetch));
 }
});
