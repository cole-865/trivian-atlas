import test from "node:test";
import assert from "node:assert/strict";
import { orderedRecordingParts, joinRecordingTranscripts } from "../src/lib/ask865/calls/conversation.js";
import { processRecordingJob, type PipelinePorts, type RecordingJob } from "../src/lib/ask865/calls/pipeline.js";
import { criteria, type Evaluation, type CallInput } from "../src/lib/ask865/calls/domain.js";
import { MediaError } from "../src/lib/ask865/calls/media.js";
const parts = [{ recordingId: "a", offsetSeconds: 10, durationSeconds: 20 }, { recordingId: "b", offsetSeconds: 35, durationSeconds: 20 }];
const raw = { segments: [{ speaker: "A", start: 1, end: 5, text: "Synthetic customer discussion." }] };
const job: RecordingJob = { id: "j", providerCallId: "c", recordingIds: ["b", "a"], recordingParts: [...parts].reverse(), employeeId: "must-not-attribute-transfer", durationSeconds: 60, direction: "inbound", startedAt: "2026-10-28T10:00:00Z", archiveFileId: null };
const policy = { consentReference: "test", approvedFrom: "2026-10-28T00:00:00Z", approvedThrough: "2026-10-29T00:00:00Z", confidenceThreshold: .8, qualityCalibrationApproved: true };
const now = Date.parse("2026-10-28T12:00:00Z");
const assessment = { category: "sales", classificationConfidence: .98, gradingConfidence: .95, sufficientEvidence: true, summary: "Complete transferred sales conversation.", criticalFlags: [], criteria: criteria.map(criterion => ({ criterion, rating: 3, reason: "Synthetic evidence", atSeconds: 36 })) };
function harness() {
 const events: string[] = [], buffers: Uint8Array[] = []; let evaluation: Evaluation | undefined, input: CallInput | undefined;
 const ports: PipelinePorts = {
  assertLease: async()=>{}, loadAnalysis:async()=>null,
  download:async id=>{events.push(`download:${id}`);const bytes=new Uint8Array([1,2,3]);buffers.push(bytes);return {bytes,mimeType:"audio/wav",extension:"wav"};},
  transcribe:async()=>raw,
  screenPurpose:async r=>{assert.deepEqual(r.segments.map(s=>s.start),[11,36]);assert.deepEqual(r.segments.map(s=>s.speaker),["part1:A","part2:A"]);return {category:"sales",confidence:.99,clearPurpose:true,customerBusinessPresent:true,criticalConcern:false};},
  redact:async r=>({transcript:r.segments.map(s=>({...s,speaker:"employee"})),privacyConfidence:.99,qualityConfidence:.95,speakerRoleConfidence:.95}),
  analyze:async c=>{events.push("analyze");assert.equal(c.employeeId,null);assert.equal(c.conversation?.parts.length,2);return assessment;},
  saveAnalysis:async(c,e)=>{events.push("save");evaluation=e;input=c;return{evaluation:e,archiveEligible:e.score!==null};},
  allocateArchiveId:async()=>`file${events.length}`,saveArchiveId:async()=>{throw Error("Must use per-part checkpoint");},
  savePartArchive:async p=>{events.push(`checkpoint:${p.recordingId}:${p.receipt?"complete":"reserved"}`);},
  archive:async(fileId,id)=>{events.push(`upload:${id}`);return{fileId,md5:"0".repeat(32),bytes:3};},complete:async()=>{events.push("complete");},
 };
 return{ports,events,buffers,get:()=>({evaluation,input})};
}
test("orders provider recordings and preserves actual gaps and independent speaker labels",()=>{
 const ordered=orderedRecordingParts(["b","a"],[...parts].reverse(),60);assert.deepEqual(ordered,parts);
 const joined=joinRecordingTranscripts(ordered,[raw,raw],60);assert.deepEqual(joined.segments.map(s=>[s.speaker,s.start,s.end]),[["part1:A",11,15],["part2:A",36,40]]);
});
test("missing, duplicate, overlapping, out-of-call and oversized manifests fail closed",()=>{
 for(const bad of [undefined,[parts[0]],[parts[0],parts[0]],[parts[0],{...parts[1],offsetSeconds:29}],[parts[0],{...parts[1],durationSeconds:30}],Array(5).fill(parts[0])])assert.throws(()=>orderedRecordingParts(["a","b"],bad,60),MediaError);
});
test("whole conversation receives one grade without assigning it to an employee; every archive has a durable checkpoint",async()=>{
 const h=harness();const result=await processRecordingJob(job,policy,h.ports,now);assert.equal(h.get().evaluation?.score,75);assert.equal(h.get().input?.recordingId,"a");assert.equal(h.get().input?.employeeId,null);assert.deepEqual(h.get().evaluation?.reasons,["conversation_review"]);assert.equal(result.archived,true);
 assert.equal(h.events.filter(e=>e==="analyze").length,1);for(const id of ["a","b"])assert.ok(h.events.indexOf(`checkpoint:${id}:reserved`)<h.events.indexOf(`upload:${id}`));assert.ok(h.buffers.every(b=>b.every(v=>v===0)));
});
test("uncalibrated whole-call grade is explicitly provisional and cannot be archived or published",async()=>{
 const h=harness();await processRecordingJob(job,{...policy,qualityCalibrationApproved:false},h.ports,now);assert.equal(h.get().evaluation?.score,null);assert.equal(h.get().evaluation?.provisionalScore,75);assert.ok(h.get().evaluation?.reasons.includes("quality_calibration_required"));assert.ok(!h.events.some(e=>e.startsWith("upload")));
});
test("uncertain whole-call quality receives no provisional grade",async()=>{
 const h=harness();h.ports.redact=async r=>({transcript:r.segments.map(s=>({...s,speaker:"unknown"})),privacyConfidence:1,qualityConfidence:.6,speakerRoleConfidence:.6});
 await processRecordingJob(job,{...policy,qualityCalibrationApproved:false},h.ports,now);assert.equal(h.get().evaluation?.score,null);assert.equal(h.get().evaluation?.provisionalScore,undefined);
});
test("failure in either part prevents partial assessment and wipes every downloaded buffer",async()=>{
 const h=harness();let n=0;h.ports.transcribe=async()=>{if(++n===2)throw new MediaError("transcription_failed");return raw;};
 await assert.rejects(processRecordingJob(job,policy,h.ports,now));assert.ok(!h.events.includes("analyze"));assert.ok(!h.events.includes("save"));assert.ok(!h.events.includes("complete"));assert.ok(h.buffers.every(b=>b.every(v=>v===0)));
});
test("missing provider timeline holds before audio download",async()=>{
 const h=harness();await processRecordingJob({...job,recordingParts:undefined},policy,h.ports,now);assert.equal(h.get().evaluation?.score,null);assert.ok(h.get().evaluation?.reasons.includes("recording_manifest_required"));assert.ok(!h.events.some(e=>e.startsWith("download")));
});
test("vendor screening examines all parts before excluding without privacy, grading or archive",async()=>{
 const h=harness();h.ports.screenPurpose=async r=>{assert.equal(r.segments.length,2);return {category:"vendor",confidence:.99,clearPurpose:true,customerBusinessPresent:false,criticalConcern:false};};h.ports.redact=async()=>{throw Error("Must exclude before redaction");};
 const r=await processRecordingJob(job,policy,h.ports,now);assert.equal(r.state,"excluded");assert.equal(h.get().evaluation?.score,null);assert.ok(!h.events.includes("analyze"));
});
test("archive retry reuses every preallocated part ID and does not reassess",async()=>{
 const h=harness();h.ports.loadAnalysis=async()=>({evaluation:{category:"sales",score:75,state:"graded",reasons:["conversation_review"],assessment:null,rubricVersion:"pilot-1"},archiveEligible:true});
 h.ports.allocateArchiveId=async()=>{throw Error("No new IDs on retry");};h.ports.archive=async(file,id)=>{assert.equal(file,`saved-${id}`);h.events.push(`upload:${id}`);return{fileId:file,md5:"0".repeat(32),bytes:3};};
 await processRecordingJob({...job,partArchives:parts.map(p=>({recordingId:p.recordingId,fileId:`saved-${p.recordingId}`,receipt:null,expiresAt:null}))},policy,h.ports,now);assert.ok(!h.events.includes("analyze"));assert.equal(h.events.filter(e=>e.startsWith("upload")).length,2);
});

 test("rubric evidence in an unrecorded transfer gap cannot support a grade",async()=>{
  const h=harness();h.ports.analyze=async()=>({...assessment,criteria:assessment.criteria.map(c=>({...c,atSeconds:32}))});
  await assert.rejects(processRecordingJob(job,policy,h.ports,now),/Invalid assessment evidence/);assert.ok(!h.events.includes("save"));
 });
