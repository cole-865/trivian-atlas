import test from "node:test";
import assert from "node:assert/strict";
import { RingCentralClient, RingCentralError, checkRingCentralConnection, ringCentralConfig } from "../src/lib/ask865/calls/ringcentral.js";

const now = Date.parse("2026-10-28T12:00:00Z");
const from = "2026-10-27T11:55:00Z", to = "2026-10-28T11:55:00Z";
const config = { clientId: "test-client", clientSecret: "test-secret", jwt: "test-jwt", accountId: "12345" };
const token = { access_token: "test-token", token_type: "bearer", expires_in: 3600 };
const call = { id: "call-1", direction: "Inbound", startTime: "2026-10-28T10:00:00Z", duration: 90, recording: { id: "101", contentUri: "https://untrusted.invalid/audio" }, from: { phoneNumber: "private-test-value" }, legs: [{ recording: { id: "102" } }, { recording: { id: "101" } }] };
const page = (records: unknown[], pageNumber = 1, totalPages = 1) => ({ records, paging: { page: pageNumber, totalPages }, navigation: { nextPage: { uri: "https://untrusted.invalid/?token=secret" } } });
function fake(replies: (unknown | Response)[]) {
  const requests: { url: string; init?: RequestInit }[] = [];
  const send = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    assert.ok(replies.length, "Unexpected provider request");
    const response = replies.shift();
    return response instanceof Response ? response : Response.json(response);
  }) as typeof fetch;
  return { requests, send };
}
function isCode(code: string) { return (error: unknown) => error instanceof RingCentralError && error.code === code; }

test("connection probe verifies account and recording metadata but exposes only counts", async () => {
  const transport = fake([token, { id: 12345 }, page([call, { ...call, id: "call-2", direction: "Outbound" }]), { id: "101", contentUri: "https://untrusted.invalid/audio" }]);
  const result = await checkRingCentralConnection(new RingCentralClient(config, transport.send, () => now), now);
  assert.equal(result.callsObserved, 2); assert.equal(result.inboundObserved, 1); assert.equal(result.outboundObserved, 1);
  assert.equal(result.uniqueRecordingsObserved, 2); assert.equal(result.recordingMetadataAccess, "verified");
  assert.equal(result.audioDownloaded, false); assert.equal(result.callsGraded, 0);
  assert.ok(!JSON.stringify(result).includes("private-test-value")); assert.ok(!JSON.stringify(result).includes("test-token"));
  assert.equal(transport.requests.length, 4);
  for (const request of transport.requests) { assert.equal(new URL(request.url).origin, "https://platform.ringcentral.com"); assert.equal(request.init?.redirect, "error"); assert.ok(!request.url.includes("/content")); }
  const body = new URLSearchParams(String(transport.requests[0].init?.body));
  assert.equal(body.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
  assert.equal(body.get("assertion"), config.jwt);
});

test("wrong account stops discovery before any call log request", async () => {
  const transport = fake([token, { id: "99999" }]);
  await assert.rejects(new RingCentralClient(config, transport.send, () => now).discover(from, to), isCode("account_mismatch"));
  assert.equal(transport.requests.length, 2);
});

test("pagination never follows remote links, merges repeated records, and reports truncation", async () => {
  const transport = fake([token, { id: "12345" }, page([call], 1, 3), page([{ ...call, recording: { id: "103" } }], 2, 3)]);
  const result = await new RingCentralClient(config, transport.send, () => now).discover(from, to, 2);
  assert.equal(result.complete, false); assert.equal(result.pagesRead, 2); assert.equal(result.calls.length, 1);
  assert.deepEqual(result.calls[0].recordingIds, ["101", "102", "103"]);
  assert.equal(new URL(transport.requests[3].url).searchParams.get("page"), "2");
  assert.ok(!JSON.stringify(result).includes("private-test-value"));
});

test("an empty recording window does not claim recording permission was verified", async () => {
  const transport = fake([token, { id: "12345" }, page([], 1, 0)]);
  const result = await checkRingCentralConnection(new RingCentralClient(config, transport.send, () => now), now);
  assert.equal(result.windowComplete, true); assert.equal(result.recordingMetadataAccess, "not_tested_no_recordings");
  assert.equal(transport.requests.length, 3);
});

test("invalid windows, page limits, path injection and missing configuration make no requests", async () => {
  const transport = fake([]); const client = new RingCentralClient(config, transport.send, () => now);
  for (const args of [["bad", to, 1], [to, from, 1], [from, "2026-10-30T00:00:00Z", 1], [from, to, 11], [from, to, 0]] as const) {
    await assert.rejects(client.discover(args[0], args[1], args[2]), isCode("invalid_window"));
  }
  await assert.rejects(client.checkRecordingMetadata("../other"), isCode("invalid_response"));
  assert.throws(() => ringCentralConfig({}), isCode("configuration_missing"));
  assert.throws(() => new RingCentralClient({ ...config, accountId: "../other" }, transport.send), isCode("configuration_missing"));
  assert.equal(transport.requests.length, 0);
});

test("provider errors do not leak secrets or caller data and do not retry a rate limit", async () => {
  for (const [status, code] of [[400, "authentication_failed"], [401, "authentication_failed"], [403, "access_denied"], [429, "rate_limited"], [500, "provider_unavailable"]] as const) {
    const transport = fake([new Response("private-test-value test-secret", { status, headers: { "retry-after": "60" } })]);
    await assert.rejects(new RingCentralClient(config, transport.send, () => now).verifyAccount(), error => {
      assert.ok(isCode(code)(error)); assert.ok(!String(error).includes("private-test-value"));
      if (status === 429) assert.equal((error as RingCentralError).retryAfterSeconds, 60);
      return true;
    });
    assert.equal(transport.requests.length, 1);
  }
});

test("invalid provider schemas and mismatched recording IDs fail closed", async () => {
  for (const data of [{ records: [], paging: { page: 2, totalPages: 2 } }, page([{ ...call, direction: "Unknown" }]), page([{ ...call, startTime: "2020-01-01T00:00:00Z" }])]) {
    const transport = fake([token, { id: "12345" }, data]);
    await assert.rejects(new RingCentralClient(config, transport.send, () => now).discover(from, to), isCode("invalid_response"));
  }
  const transport = fake([token, { id: "12345" }, { id: "wrong-recording" }]);
  await assert.rejects(new RingCentralClient(config, transport.send, () => now).checkRecordingMetadata("101"), isCode("invalid_response"));
});

test("oversized response is canceled without exposing its contents", async () => {
  const transport = fake([new Response('"' + 'x'.repeat(2_000_001) + '"')]);
  await assert.rejects(new RingCentralClient(config, transport.send, () => now).verifyAccount(), isCode("invalid_response"));
});

test("one client reuses token until expiry and re-verifies account after renewal", async () => {
  let clock = now;
  const transport = fake([token, { id: "12345" }, page([call]), page([call]), token, { id: "99999" }]);
  const client = new RingCentralClient(config, transport.send, () => clock);
  await client.discover(from, to); await client.discover(from, to);
  assert.equal(transport.requests.filter(r => r.url.endsWith("/token")).length, 1);
  clock += 3600_000;
  await assert.rejects(client.discover(from, to), isCode("account_mismatch"));
  assert.equal(transport.requests.length, 6);
});


test("live provider pagination may omit totalPages and use navigation links", async () => {
  const first = { records: [call], paging: { page: 1, perPage: 100 }, navigation: { nextPage: { uri: "https://untrusted.invalid/next" } } };
  const last = { records: [{ ...call, id: "call-2" }], paging: { page: 2, pageStart: 100, pageEnd: 100 }, navigation: { previousPage: { uri: "ignored" } } };
  const transport = fake([token, { id: "12345" }, first, last]);
  const result = await new RingCentralClient(config, transport.send, () => now).discover(from, to);
  assert.equal(result.complete, true); assert.equal(result.pagesRead, 2); assert.equal(result.calls.length, 2);
  assert.equal(new URL(transport.requests[3].url).origin, "https://platform.ringcentral.com");
  assert.equal(new URL(transport.requests[3].url).searchParams.get("page"), "2");
});

test("missing pagination evidence never silently claims a complete window", async () => {
  const transport = fake([token, { id: "12345" }, { records: [call], paging: { page: 1 } }]);
  await assert.rejects(new RingCentralClient(config, transport.send, () => now).discover(from, to), isCode("invalid_response"));
});
