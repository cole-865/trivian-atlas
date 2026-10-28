import test from "node:test";
import assert from "node:assert/strict";
import { discoveryPlan, discoverWithCheckpoint } from "../src/lib/ask865/calls/scheduler";
const now=Date.parse("2026-10-28T15:00:00Z"), start="2026-10-20T00:00:00Z",end="2026-11-01T00:00:00Z";
test("discovery catches up without losing recent delayed recordings",()=>{const p=discoveryPlan(start,start,end,now);assert.equal(p.windows.length,2);assert.equal(p.nextCursor,"2026-10-20T06:00:00.000Z");assert.equal(p.windows[1].dateTo,"2026-10-28T14:55:00.000Z");for(const w of p.windows)assert.ok(Date.parse(w.dateTo)-Date.parse(w.dateFrom)<=86400000);});
test("scan failure never advances the durable checkpoint",async()=>{let finished=false;let scans=0;await assert.rejects(discoverWithCheckpoint(discoveryPlan(start,start,end,now),async()=>{if(++scans===2)throw Error("partial");},async()=>{finished=true;}));assert.equal(finished,false);});
test("checkpoint runs only after every complete enqueue",async()=>{const events:string[]=[];await discoverWithCheckpoint(discoveryPlan(start,start,end,now),async()=>{events.push("enqueue");},async()=>{events.push("commit");});assert.deepEqual(events,["enqueue","enqueue","commit"]);});
test("invalid dates and future cursors fail closed",()=>{assert.throws(()=>discoveryPlan("bad",start,end,now));assert.throws(()=>discoveryPlan(end,start,end,now));assert.throws(()=>discoveryPlan(start,end,start,now));});
test("provider lag does not advance past the safe cutoff",()=>{const p=discoveryPlan("2026-10-28T14:58:00Z",start,end,now);assert.equal(p.windows.length,0);assert.equal(p.nextCursor,"2026-10-28T14:58:00Z");});
