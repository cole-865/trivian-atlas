import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { audioByteRange, inspectAudio, limitedBytes, maxAudioBytes, MediaError } from "../src/lib/ask865/calls/media.js";
import { RingCentralClient } from "../src/lib/ask865/calls/ringcentral.js";
import { transcribeAudio, diarizationModel, diarizationShutdown, validateTranscript } from "../src/lib/ask865/calls/transcription.js";
import { redactTranscript, maskStructuredIdentifiers } from "../src/lib/ask865/calls/privacy.js";
import { archiveKey, PrivateDriveArchive } from "../src/lib/ask865/calls/drive.js";
import { processRecordingJob, fiveYearExpiry, type PipelinePorts, type RecordingJob } from "../src/lib/ask865/calls/pipeline.js";
import { criteria, type Evaluation } from "../src/lib/ask865/calls/domain.js";
import { analyzeTranscript } from "../src/lib/ask865/calls/assessmentTransport.js";
import { employeeMapper } from "../src/lib/ask865/calls/employeeMapping.js";

const now = Date.parse("2026-10-28T12:00:00Z");
const audio = () => inspectAudio(new Uint8Array(Buffer.from("RIFF1234WAVEsynthetic fixture")), "audio/wav");
const raw = { segments: [{ speaker: "A", start: 0, end: 10, text: "Hello. How may I help?" }, { speaker: "B", start: 11, end: 30, text: "Can I book a test drive?" }] };
const envelope = (data: unknown) => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(data) }] }] });
const privacy = { safeToAnalyze: true, privacyConfidence: 0.99, transcriptQualityConfidence: 0.9, speakerRoleConfidence: 0.9, segments: raw.segments.map((s, index) => ({ index, speaker: index ? "customer" : "employee", text: s.text })) };
function fake(replies: (unknown | Response)[]) {
  const requests: { url: string; init?: RequestInit }[] = [];
  return { requests, send: (async (url, init) => { requests.push({ url: String(url), init }); assert.ok(replies.length, "Unexpected request"); const next = replies.shift(); return next instanceof Response ? next : Response.json(next); }) as typeof fetch };
}
const isCode = (code: string) => (error: unknown) => error instanceof MediaError && error.code === code;

test("audio limits reject chunked overflow, oversized headers, and disguised HTML", async () => {
  await assert.rejects(limitedBytes(new Response("123456"), 4), isCode("response_too_large"));
  await assert.rejects(limitedBytes(new Response("a", { headers: { "content-length": String(maxAudioBytes + 1) } }), maxAudioBytes), isCode("response_too_large"));
  assert.throws(() => inspectAudio(new Uint8Array(Buffer.from("<html>secret</html>")), "audio/mpeg"), isCode("unsupported_audio"));
});
test("RingCentral audio uses the verified account and fixed content path without redirects", async () => {
  const transport = fake([{ access_token: "token", token_type: "bearer", expires_in: 3600 }, { id: "123" }, { id: "456", contentUri: "https://evil.invalid" }, new Response(new Uint8Array(audio().bytes), { headers: { "content-type": "audio/wav" } })]);
  const client = new RingCentralClient({ clientId: "client", clientSecret: "secret", jwt: "jwt", accountId: "123" }, transport.send, () => now);
  const result = await client.downloadRecording("456"); assert.equal(result.mimeType, "audio/wav");
  const last = transport.requests.at(-1)!; assert.equal(last.url, "https://platform.ringcentral.com/restapi/v1.0/account/123/recording/456/content"); assert.equal(last.init?.redirect, "error");
});
test("transcription requests timestamps and speaker labels, with generic filename and bounded response", async () => {
  const transport = fake([raw]); const result = await transcribeAudio(audio(), 30, { apiKey: "secret", model: diarizationModel }, transport.send, now);
  assert.deepEqual(result, raw); const form = transport.requests[0].init?.body as FormData;
  assert.equal(form.get("response_format"), "diarized_json"); assert.equal(form.get("chunking_strategy"), "auto");
  assert.equal((form.get("file") as File).name, "recording.wav"); assert.equal(transport.requests[0].init?.redirect, "error");
});
test("retired transcription model and invalid timestamps stop processing", async () => {
  const transport = fake([]);
  await assert.rejects(transcribeAudio(audio(), 30, { apiKey: "secret", model: diarizationModel }, transport.send, diarizationShutdown), isCode("transcriber_configuration_required"));
  assert.throws(() => validateTranscript({ segments: [{ ...raw.segments[0], end: 500 }] }, 30), isCode("invalid_transcript_timestamps"));
  assert.equal(transport.requests.length, 0);
});
test("privacy pass does not store provider output and preserves real segment timestamps", async () => {
  const transport = fake([envelope(privacy)]); const result = await redactTranscript(raw, 30, { apiKey: "secret", model: "configured-test-model" }, transport.send);
  assert.equal(result.transcript[1].start, 11); assert.equal(result.transcript[1].speaker, "customer");
  const body = JSON.parse(String(transport.requests[0].init?.body)); assert.equal(body.store, false);
  assert.equal(maskStructuredIdentifiers("a@example.com 123-45-6789"), "[EMAIL] [IDENTIFIER]");
});
test("uncertain redaction, truncated output and segment invention all fail closed", async () => {
  for (const result of [{ ...privacy, safeToAnalyze: false }, { ...privacy, privacyConfidence: 0.8 }, { ...privacy, segments: privacy.segments.slice(0, 1) }, { ...privacy, segments: [{ ...privacy.segments[0], index: 1 }, privacy.segments[1]] }]) {
    await assert.rejects(redactTranscript(raw, 30, { apiKey: "secret", model: "test" }, fake([envelope(result)]).send), error => error instanceof MediaError);
  }
  await assert.rejects(redactTranscript(raw, 30, { apiKey: "secret", model: "test" }, fake([{ ...envelope(privacy), status: "incomplete" }]).send), isCode("privacy_review_failed"));
});
const driveConfig = { clientId: "client", clientSecret: "secret", refreshToken: "refresh", ownerPermissionId: "owner", folderId: "private-folder" };
const token = { access_token: "token", expires_in: 3600, token_type: "Bearer" };
const account = { user: { permissionId: "owner" } };
const folder = { id: "private-folder", mimeType: "application/vnd.google-apps.folder", trashed: false, capabilities: { canAddChildren: true } };
const permissions = { permissions: [{ id: "owner", type: "user", role: "owner" }] };
const identity = { organizationId: "10000000-0000-4000-8000-000000000001", accountId: "123", recordingId: "456" };
const file = () => ({ id: "preallocated", trashed: false, parents: ["private-folder"], size: String(audio().bytes.length), md5Checksum: createHash("md5").update(audio().bytes).digest("hex"), appProperties: { ask865ArchiveKey: archiveKey(identity) } });
test("Drive verifies account and rejects link or extra-person access before upload", async () => {
  const wrong = fake([token, { user: { permissionId: "other" } }]);
  await assert.rejects(new PrivateDriveArchive(driveConfig, wrong.send).allocateFileId(), isCode("drive_account_mismatch"));
  const shared = fake([token, account, folder, { permissions: [...permissions.permissions, { id: "anyone", type: "anyone", role: "reader" }] }]);
  await assert.rejects(new PrivateDriveArchive(driveConfig, shared.send).allocateFileId(), isCode("drive_private_folder_required"));
  assert.ok(shared.requests.every(r => r.init?.method !== "PUT"));
});
test("retry recovers an already uploaded file by stable ID and checksum without uploading again", async () => {
  const transport = fake([token, account, folder, permissions, file(), permissions]);
  const result = await new PrivateDriveArchive(driveConfig, transport.send).upload("preallocated", identity, audio());
  assert.equal(result.fileId, "preallocated"); assert.ok(transport.requests.slice(1).every(r => !r.init?.method));
});
test("Drive refuses checksum mismatches and hostile upload locations", async () => {
  const mismatch = fake([token, account, folder, permissions, { ...file(), md5Checksum: "bad" }]);
  await assert.rejects(new PrivateDriveArchive(driveConfig, mismatch.send).upload("preallocated", identity, audio()), isCode("drive_archive_mismatch"));
  const hostile = fake([token, account, folder, permissions, new Response(null, { status: 404 }), new Response(null, { headers: { location: "https://evil.invalid/upload?upload_id=1" } })]);
  await assert.rejects(new PrivateDriveArchive(driveConfig, hostile.send).upload("preallocated", identity, audio()), isCode("drive_invalid_upload_url"));
  assert.ok(hostile.requests.every(r => !r.url.includes("evil")));
});
test("Drive upload includes opaque filename and confirms private permissions and checksum", async () => {
  const transport = fake([token, account, folder, permissions, new Response(null, { status: 404 }), new Response(null, { headers: { location: "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=synthetic" } }), {}, file(), permissions]);
  const result = await new PrivateDriveArchive(driveConfig, transport.send).upload("preallocated", identity, audio());
  assert.equal(result.md5, file().md5Checksum); const metadata = JSON.parse(String(transport.requests[5].init?.body));
  assert.equal(metadata.id, "preallocated"); assert.match(metadata.name, /^[a-f0-9]{64}\.wav$/); assert.deepEqual(metadata.parents, ["private-folder"]);
});
const job: RecordingJob = { id: "job", providerCallId: "call", recordingIds: ["456"], startedAt: "2026-10-28T10:00:00Z", direction: "inbound", durationSeconds: 30, employeeId: "verified-employee", archiveFileId: null };
const policy = { consentReference: "approved-policy", approvedFrom: "2026-10-28T00:00:00Z", approvedThrough: "2026-10-29T00:00:00Z", confidenceThreshold: 0.8, qualityCalibrationApproved: true };
const assessment = { category: "sales", classificationConfidence: 0.95, gradingConfidence: 0.9, sufficientEvidence: true, summary: "Discussed a test drive.", criticalFlags: [], criteria: criteria.map(criterion => ({ criterion, rating: 3, reason: "Synthetic evidence", atSeconds: 10 })) };
function ports() {
  const events: string[] = []; const buffer = audio(); let saved: Evaluation | null = null;
  const p: PipelinePorts = {
    assertLease: async () => { events.push("lease"); }, loadAnalysis: async () => null,
    download: async () => { events.push("download"); return buffer; }, transcribe: async () => raw,
    screenPurpose: async () => ({ category: "sales", confidence: 0.99, clearPurpose: true, customerBusinessPresent: true, criticalConcern: false }),
    redact: async () => ({ transcript: raw.segments.map((s, i) => ({ ...s, speaker: i ? "customer" : "employee" })), privacyConfidence: 0.99, qualityConfidence: 0.9, speakerRoleConfidence: 0.9 }),
    analyze: async () => assessment,
    saveAnalysis: async (_input, evaluation) => { saved = evaluation; events.push("save_analysis"); return { evaluation, archiveEligible: evaluation.category === "sales" && !evaluation.reasons.includes("low_confidence") }; },
    allocateArchiveId: async () => { events.push("allocate"); return "preallocated"; },
    saveArchiveId: async () => { events.push("save_id"); },
    archive: async () => { events.push("upload"); return { fileId: "preallocated", md5: "0".repeat(32), bytes: 10 }; },
    complete: async () => { events.push("complete"); },
  };
  return { p, events, buffer, saved: () => saved };
}
test("full synthetic recording slice grades, checkpoints ID before upload, and releases audio", async () => {
  const { p, events, buffer, saved } = ports(); const result = await processRecordingJob(job, policy, p, now);
  assert.equal(saved()?.score, 75); assert.equal(result.archived, true);
  assert.ok(events.indexOf("save_analysis") < events.indexOf("save_id")); assert.ok(events.indexOf("save_id") < events.indexOf("upload")); assert.ok(buffer.bytes.every(b => b === 0));
});
test("unverified consent makes zero provider or persistence calls", async () => {
  const { p, events } = ports(); await assert.rejects(processRecordingJob(job, { ...policy, approvedFrom: "2026-10-29T00:00:00Z" }, p, now), isCode("consent_review_required")); assert.equal(events.length, 0);
});
test("uncalibrated transcript confidence prevents an automatic grade and long-term archive", async () => {
  const { p, events, saved } = ports(); const result = await processRecordingJob(job, { ...policy, qualityCalibrationApproved: false }, p, now);
  assert.equal(saved()?.score, null); assert.equal(result.archived, false); assert.ok(!events.includes("upload"));
});
test("excluded and multi-recording calls are never given an eligible five-year archive", async () => {
  const excluded = ports(); excluded.p.analyze = async () => ({ ...assessment, category: "payments" });
  const result = await processRecordingJob(job, policy, excluded.p, now); assert.equal(result.archived, false); assert.equal(excluded.saved()?.score, null);
  const multi = ports(); await processRecordingJob({ ...job, recordingIds: ["456", "789"] }, policy, multi.p, now); assert.ok(!multi.events.includes("download"));
});
test("failed upload releases audio and retains stable checkpoint for retry", async () => {
  const { p, events, buffer } = ports(); p.archive = async () => { throw new MediaError("drive_unavailable"); };
  await assert.rejects(processRecordingJob(job, policy, p, now), isCode("drive_unavailable")); assert.ok(events.includes("save_id")); assert.ok(!events.includes("complete")); assert.ok(buffer.bytes.every(b => b === 0));
});
test("privacy uncertainty becomes a management-review hold without retrying or grading", async () => {
  const {p,events,saved,buffer}=ports(); p.redact=async()=>{throw new MediaError("privacy_review_required");};
  p.analyze=async()=>{throw new Error("Must not grade blocked transcript");};
  const result=await processRecordingJob(job,policy,p,now);
  assert.equal(result.state,"manual_review"); assert.equal(saved()?.score,null); assert.deepEqual(saved()?.reasons,["privacy_review_required"]);
  assert.ok(events.includes("complete")); assert.ok(!events.includes("upload")); assert.ok(buffer.bytes.every(b=>b===0));
});
test("five-year retention is based on call date and handles leap days", () => {
  assert.equal(fiveYearExpiry("2024-02-29T12:00:00Z"), "2029-02-28T12:00:00.000Z");
});
test("playback supports one bounded range and rejects malformed or multiple ranges", () => {
  assert.deepEqual(audioByteRange("bytes=10-20",100),{start:10,end:20,partial:true});
  assert.deepEqual(audioByteRange("bytes=-10",100),{start:90,end:99,partial:true});
  assert.deepEqual(audioByteRange("bytes=90-200",100),{start:90,end:99,partial:true});
  for (const invalid of ["bytes=100-", "bytes=10-5", "bytes=-0", "bytes=1-2,4-5", "bytes=-", "bytes=99999999999999999999-"]) assert.throws(() => audioByteRange(invalid,100),isCode("invalid_range"));
});
test("private playback re-verifies file permissions and content checksum", async () => {
  const original=audio();
  const transport=fake([token,account,folder,permissions,file(),permissions,new Response(new Uint8Array(original.bytes),{headers:{"content-type":"audio/wav"}})]);
  const result=await new PrivateDriveArchive(driveConfig,transport.send).download({fileId:"preallocated",md5:file().md5Checksum,bytes:original.bytes.length},identity);
  assert.deepEqual(result.bytes,original.bytes); assert.ok(transport.requests.at(-1)?.url.endsWith("?alt=media"));
});
test("assessment transport requires completed structured output and refuses unapproved input", async () => {
  const call = { providerCallId: "synthetic", recordingId: "456", employeeId: "employee", startedAt: job.startedAt, direction: job.direction, durationSeconds: 30, connected: true, consent: "approved" as const, consentReference: "policy", redacted: true, transcriptConfidence: 0.9,
    transcript: raw.segments.map((s, i) => ({ ...s, speaker: i ? "customer" as const : "employee" as const })) };
  const transport=fake([envelope(assessment)]);
  assert.equal((await analyzeTranscript(call,{apiKey:"test",model:"configured"},transport.send)).category,"sales");
  assert.equal(JSON.parse(String(transport.requests[0].init?.body)).store,false);
  await assert.rejects(analyzeTranscript({...call,consent:"unknown",transcript:[]},{apiKey:"test",model:"configured"},fake([]).send),isCode("analysis_failed"));
});
test("employee mapping uses stable provider ID and effective dates; transfers and overlaps remain unmapped", () => {
  const config={extensionId:"stable-id",employeeId:"employee-1",validFrom:policy.approvedFrom,validThrough:policy.approvedThrough};
  const discovery={callId:"call",recordingIds:["456"],extensionIds:["stable-id"],direction:job.direction,startedAt:job.startedAt,durationSeconds:30};
  const mapper=employeeMapper(JSON.stringify([config]));
  assert.equal(mapper(discovery),"employee-1"); assert.equal(mapper({...discovery,extensionIds:["103"]}),null);
  assert.equal(mapper({...discovery,extensionIds:["stable-id","another"]}),null);
  assert.equal(mapper({...discovery,startedAt:"2025-01-01T00:00:00Z"}),null);
  assert.equal(employeeMapper(JSON.stringify([config,config]))(discovery),null);
});

test("clear vendor calls are excluded before privacy/quality review, even before calibration", async () => {
  const {p,events,saved,buffer}=ports();
  p.screenPurpose=async()=>({category:"vendor",confidence:0.99,clearPurpose:true,customerBusinessPresent:false,criticalConcern:false});
  p.redact=async()=>{throw new Error("Excluded vendors must not enter privacy review");};
  p.analyze=async()=>{throw new Error("Excluded vendors must not be graded");};
  const result=await processRecordingJob(job,{...policy,qualityCalibrationApproved:false},p,now);
  assert.deepEqual(result,{state:"excluded",archived:false});
  assert.equal(saved()?.category,"vendor");assert.equal(saved()?.score,null);assert.deepEqual(saved()?.reasons,[]);
  assert.equal(saved()?.screening?.version,"purpose-1");assert.equal(saved()?.assessment,null);
  assert.ok(!events.includes("upload"));assert.ok(buffer.bytes.every(b=>b===0));
});
test("uncertain vendor, mixed customer business and critical concerns cannot bypass privacy review", async () => {
  for(const change of [{confidence:0.94},{clearPurpose:false},{customerBusinessPresent:true},{criticalConcern:true}]) {
    const {p,saved}=ports();p.screenPurpose=async()=>({category:"vendor",confidence:0.99,clearPurpose:true,customerBusinessPresent:false,criticalConcern:false,...change});
    p.redact=async()=>{throw new MediaError("privacy_review_required");};
    const result=await processRecordingJob(job,policy,p,now);
    assert.equal(result.state,"manual_review");assert.equal(saved()?.score,null);assert.deepEqual(saved()?.reasons,["privacy_review_required"]);
  }
});
test("purpose provider failure neither excludes nor persists a false successful review", async()=>{
 const {p,events,buffer}=ports();p.screenPurpose=async()=>{throw new MediaError("purpose_screening_failed");};
 await assert.rejects(processRecordingJob(job,policy,p,now),isCode("purpose_screening_failed"));
 assert.ok(!events.includes("complete"));assert.ok(!events.includes("upload"));assert.ok(buffer.bytes.every(b=>b===0));
});

test("a purpose-screen critical concern survives a later assessment with no flags",async()=>{
 const {p,saved}=ports();p.screenPurpose=async()=>({category:"sales",confidence:0.99,clearPurpose:true,customerBusinessPresent:true,criticalConcern:true});
 await processRecordingJob(job,policy,p,now);assert.ok(saved()?.reasons.includes("critical_flag"));
});
test("strong customer-purpose evidence remains visible when privacy blocks grading",async()=>{
 const {p,saved}=ports();p.screenPurpose=async()=>({category:"service",confidence:0.99,clearPurpose:true,customerBusinessPresent:true,criticalConcern:false});
 p.redact=async()=>{throw new MediaError("privacy_review_required");};
 await processRecordingJob(job,policy,p,now);assert.equal(saved()?.category,"service");assert.equal(saved()?.score,null);assert.equal(saved()?.screening?.category,"service");
});
