import test from "node:test";
import assert from "node:assert/strict";
import { analyzeCall, callInputSchema, categories, coachingTrends, correctionSchema, criteria, evaluate, isExcluded, rubricVersion, rubrics, type Assessment, type CallInput, type CallRecord } from "../src/lib/ask865/calls/domain.js";
import { resolveDealershipPermissionsFromRows } from "../src/lib/auth/dealershipPermissionRules.js";

function call(): CallInput { return { providerCallId: "synthetic-call-1", recordingId: "synthetic-recording-1", employeeId: "synthetic-agent", startedAt: new Date().toISOString(), direction: "inbound", durationSeconds: 120, connected: true, consent: "approved", consentReference: "synthetic-policy", redacted: true, transcriptConfidence: .95, transcript: [{ start: 0, end: 100, speaker: "employee", text: "Synthetic call fixture. May we schedule your visit?" }] }; }
function assessment(): Assessment { return { category: "sales", classificationConfidence: .95, gradingConfidence: .95, sufficientEvidence: true, summary: "Synthetic appointment conversation", criteria: criteria.map(criterion => ({ criterion, rating: 3, reason: "Synthetic evidence", atSeconds: 20 })), criticalFlags: [] }; }
function row(changes: Partial<CallRecord> = {}): CallRecord { return { id: "test-id", organization_id: "test-org", provider_call_id: "synthetic-call-1", employee_id: "synthetic-agent", direction: "inbound", started_at: new Date().toISOString(), category: "sales", score: 75, ai_category: "sales", ai_score: 75, evaluation: evaluate(call(), assessment(), .8), status: "not_required", revision: 1, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString(), ...changes }; }

test("all four context rubrics total 100 and produce 0–100 grades", () => {
  for (const category of ["sales", "service"] as const) for (const direction of ["inbound", "outbound"] as const) {
    assert.equal(rubrics[category][direction].reduce((a, b) => a + b, 0), 100);
    for (const rating of [0, 2, 4]) {
      const a = assessment(); a.category = category; a.criteria.forEach(c => { c.rating = rating; });
      assert.equal(evaluate({ ...call(), direction }, a, .8).score, rating * 25);
    }
  }
});
test("every excluded category has no score and retains no narrative evidence", () => {
  for (const category of categories.filter(isExcluded)) {
    const a = { ...assessment(), category };
    const result = evaluate(call(), a, .8);
    assert.equal(result.state, "excluded"); assert.equal(result.score, null); assert.equal(result.assessment, null);
  }
});
test("low confidence exclusions and mixed calls go to manual review", () => {
  for (const a of [{ ...assessment(), category: "vendor", classificationConfidence: .5 }, { ...assessment(), category: "mixed" }, { ...assessment(), category: "unknown" }]) {
    const result = evaluate(call(), a, .8); assert.equal(result.score, null); assert.equal(result.state, "manual_review");
  }
});
test("N/A is normalized, while wholly inapplicable or insufficient calls are unscored", () => {
  const a = assessment(); a.criteria.forEach(c => { c.rating = null; c.atSeconds = null; });
  assert.equal(evaluate(call(), a, .8).score, null);
  a.criteria[0].rating = 4; a.criteria[0].atSeconds = 1;
  assert.equal(evaluate(call(), a, .8).score, 100);
  a.sufficientEvidence = false; assert.equal(evaluate(call(), a, .8).score, null);
});
test("exact threshold is below 70, and critical flags escalate high scores", () => {
  const a = assessment(); a.criteria.forEach(c => { c.rating = 4; });
  a.criteria[3].rating = 0; a.criteria[0].rating = 0;
  assert.equal(evaluate(call(), a, .8).score, 70);
  assert.ok(!evaluate(call(), a, .8).reasons.includes("below_70"));
  a.criteria[5].rating = 3;
  assert.ok(evaluate(call(), a, .8).reasons.includes("below_70"));
  a.criteria.forEach(c => { c.rating = 4; });
  a.criticalFlags.push({ code: "misleading_promise", reason: "Synthetic concern", atSeconds: 60 });
  const result = evaluate(call(), a, .8); assert.equal(result.score, 100); assert.ok(result.reasons.includes("critical_flag"));
});
test("consent, unanswered, missing audio, redaction and missing transcript stop provider calls", async () => {
  for (const change of [{ consent: "unknown" as const }, { consentReference: null }, { connected: false }, { recordingId: null }, { redacted: false }, { transcript: [] }]) {
    let sent = false;
    const result = await analyzeCall({ ...call(), ...change }, async () => { sent = true; return assessment(); }, .8);
    assert.equal(sent, false); assert.equal(result.score, null); assert.equal(result.state, "not_evaluable");
  }
});
test("poor transcript, low grading confidence, and unidentified employee cannot get an automatic grade", () => {
  for (const c of [{ ...call(), transcriptConfidence: .6 }, { ...call(), employeeId: null }]) assert.equal(evaluate(c, assessment(), .8).score, null);
  assert.equal(evaluate(call(), { ...assessment(), gradingConfidence: .7 }, .8).score, null);
});
test("invalid model output, duplicate criteria, missing criteria and invented timestamps fail closed", () => {
  const duplicate = assessment(); duplicate.criteria[1] = duplicate.criteria[0];
  const noTime = assessment(); noTime.criteria[0].atSeconds = null;
  const future = assessment(); future.criteria[0].atSeconds = 121;
  for (const a of [{}, { ...assessment(), criteria: [] }, duplicate, future, noTime, { ...assessment(), gradingConfidence: 2 }]) assert.throws(() => evaluate(call(), a, .8));
  assert.throws(() => evaluate(call(), assessment(), NaN));
});
test("unapproved transcripts, cross-organization input, recording URLs and invalid timestamps are rejected", () => {
  assert.ok(callInputSchema.safeParse(call()).success);
  for (const change of [{ organizationId: "other-org" }, { consent: "unknown" }, { recordingId: "https://evil.example/audio" }, { transcript: [{ start: 50, end: 5, speaker: "employee", text: "test" }] }]) assert.equal(callInputSchema.safeParse({ ...call(), ...change }).success, false);
});
test("manager corrections require reason, revision, and valid category/score", () => {
  const review = { expectedRevision: 1, category: "sales", score: 80, status: "resolved", reason: "Verified next step" };
  assert.ok(correctionSchema.safeParse(review).success);
  for (const change of [{ reason: "" }, { score: 101 }, { score: -1 }, { score: 2.5 }, { expectedRevision: 0 }, { category: "vendor" }, { organizationId: "other-org" }, { status: "not_required" }]) assert.equal(correctionSchema.safeParse({ ...review, ...change }).success, false);
});
test("trends use corrected eligible scores only, exclude expired, unscored and out-of-window calls", () => {
  const now = Date.now();
  const data = [row({ score: 60 }), row({ score: 90, ai_score: 50, revision: 2 }), row({ category: "vendor", score: null }), row({ score: null }), row({ started_at: new Date(now - 8 * 86400000).toISOString() }), row({ expires_at: new Date(now - 1).toISOString() }), row({ started_at: new Date(now + 600000).toISOString() })];
  const trends = coachingTrends(data, now + 1);
  assert.equal(trends.length, 1); assert.equal(trends[0].count, 2); assert.equal(trends[0].average, 75); assert.equal(trends[0].below70, 1);
});
test("management/admin can review calls, sales cannot, and individual denials prevail", () => {
  for (const role of ["sales", "management", "admin"] as const) {
    assert.equal(resolveDealershipPermissionsFromRows({ role, roleRows: [], overrideRows: [] }).review_ask865_calls, role !== "sales");
    assert.equal(resolveDealershipPermissionsFromRows({ role, roleRows: [], overrideRows: [{ permission_key: "review_ask865_calls", allowed: false }] }).review_ask865_calls, false);
  }
});

test("trusted transcript to assessment to review is a complete synthetic scoring slice", async () => {
  const input = callInputSchema.parse(call());
  const a = assessment(); a.criteria.forEach(c => { c.rating = 2; });
  const result = await analyzeCall(input, async received => { assert.equal(received.providerCallId, input.providerCallId); return a; }, .8);
  assert.equal(result.score, 50); assert.equal(result.rubricVersion, rubricVersion); assert.deepEqual(result.reasons, ["below_70"]);
});
