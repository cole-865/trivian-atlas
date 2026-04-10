import test from "node:test";
import assert from "node:assert/strict";
import {
  getHealthResponseInit,
  getHealthResponsePayload,
} from "../src/lib/health/response.js";

test("healthy health responses expose only a minimal safe payload", () => {
  assert.deepEqual(getHealthResponsePayload(true), {
    ok: true,
  });

  assert.deepEqual(getHealthResponseInit(true), {
    status: 200,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
});

test("unhealthy health responses stay minimal and avoid internal details", () => {
  const payload = getHealthResponsePayload(false);

  assert.deepEqual(payload, {
    ok: false,
  });
  assert.equal("db" in payload, false);
  assert.equal("user" in payload, false);
  assert.equal("sampleDealCount" in payload, false);

  assert.deepEqual(getHealthResponseInit(false), {
    status: 503,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
});
