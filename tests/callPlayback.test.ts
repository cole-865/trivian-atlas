import test from "node:test";
import assert from "node:assert/strict";
import { playbackSource, playbackResponse, type PlaybackCall, type PlaybackJob } from "../src/lib/ask865/calls/playback.js";
import { categories } from "../src/lib/ask865/calls/domain.js";
const now = Date.parse("2026-10-28T12:00:00Z");
const call: PlaybackCall = { category: "unknown", consent_reference: "confirmed", recording_id: "recording-1", expires_at: "2031-10-28T12:00:00Z",
  evaluation: { state: "not_evaluable", category: "unknown", score: null, reasons: ["privacy_review_required"], assessment: null, rubricVersion: "pilot-1" } };
const job: PlaybackJob = { jobId: "job-1", recordingId: "recording-1", receipt: null, expiresAt: null };

test("privacy holds allow source playback without granting grading or archive approval", () => {
  const before = structuredClone(call);
  assert.equal(playbackSource(call, job, now), "provider");
  assert.deepEqual(call, before);
  for (const category of categories) {
    assert.equal(playbackSource({ ...call, category }, job, now), ["sales", "service", "mixed", "unknown"].includes(category) ? "provider" : null);
  }
});
test("source playback rejects missing consent, expired reviews, mismatched recordings and unrelated holds", () => {
  for (const change of [{ consent_reference: null }, { consent_reference: " " }, { recording_id: null }, { recording_id: "another" }, { expires_at: new Date(now).toISOString() },
    { evaluation: { ...call.evaluation, reasons: ["consent_unverified"] } }, { evaluation: { ...call.evaluation, state: "manual_review" as const } }]) {
    assert.equal(playbackSource({ ...call, ...change }, job, now), null);
  }
  assert.equal(playbackSource(call, null, now), null);
});
test("archive playback still needs an eligible call and an unexpired matching receipt", () => {
  const archived = { ...job, receipt: { fileId: "private", md5: "checksum", bytes: 30 }, expiresAt: "2031-10-28T12:00:00Z" };
  const graded = { ...call, category: "sales" as const, evaluation: { ...call.evaluation, state: "graded" as const, reasons: [] } };
  assert.equal(playbackSource(graded, archived, now), "archive");
  assert.equal(playbackSource(graded, { ...archived, expiresAt: new Date(now).toISOString() }, now), null);
  assert.equal(playbackSource({ ...graded, category: "vendor" }, archived, now), null);
});
test("audit failure prevents provider access and audio release", async () => {
  let downloaded = false;
  await assert.rejects(playbackResponse(null, { audit: async () => { throw new Error("audit unavailable"); }, download: async () => { downloaded = true; throw new Error("Must not download"); } }));
  assert.equal(downloaded, false);
});
test("playback logs first, returns private bounded audio, and clears its source buffer", async () => {
  const events: string[] = [], bytes = new Uint8Array([1,2,3,4,5]);
  const response = await playbackResponse("bytes=1-3", { audit: async () => { events.push("audit"); }, download: async () => { events.push("download"); return { bytes, mimeType: "audio/wav", extension: "wav" }; } });
  assert.deepEqual(events, ["audit", "download"]);
  assert.equal(response.status, 206); assert.equal(response.headers.get("content-range"), "bytes 1-3/5");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [2,3,4]);
  assert.ok(bytes.every(value => value === 0));
});
test("invalid playback ranges release no audio and clear source buffers", async () => {
  const bytes = new Uint8Array([1,2,3]);
  const response = await playbackResponse("bytes=0-1,2-3", { audit: async () => {}, download: async () => ({ bytes, mimeType: "audio/wav", extension: "wav" }) });
  assert.equal(response.status, 416); assert.equal((await response.arrayBuffer()).byteLength, 0);
  assert.ok(bytes.every(value => value === 0));
});

test("retained customer calls can be heard for calibration without an archive or score", () => {
  for (const category of ["sales","service"] as const) {
    const review = {...call, category, evaluation:{...call.evaluation,state:"manual_review" as const,reasons:["quality_calibration_required"]}};
    assert.equal(playbackSource(review,job,now),"provider");
    assert.equal(playbackSource({...review,consent_reference:null},job,now),null);
  }
});

test("each transferred recording is authorized through its same-call anchor, never a caller-supplied provider ID",()=>{
 const review={...call,category:"sales" as const,evaluation:{...call.evaluation,state:"manual_review" as const,reasons:["conversation_review"]}};
 const part={...job,recordingId:"recording-2",reviewRecordingId:"recording-1"};
 assert.equal(playbackSource(review,part,now),"provider");
 assert.equal(playbackSource({...review,recording_id:"other-call"},part,now),null);
 assert.equal(playbackSource({...review,category:"vendor"},part,now),null);
 assert.equal(playbackSource({...review,consent_reference:null},part,now),null);
});
