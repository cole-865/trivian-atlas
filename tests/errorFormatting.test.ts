import test from "node:test";
import assert from "node:assert/strict";
import { formatWorkerError } from "../services/credit-worker/src/errorFormatting.js";

test("formatWorkerError preserves normal Error messages", () => {
  assert.equal(formatWorkerError(new Error("upload failed")), "Error: upload failed");
});

test("formatWorkerError stringifies nested Supabase details", () => {
  assert.equal(
    formatWorkerError({
      message: "Database error",
      details: { reason: "policy violation" },
      code: "42501",
    }),
    'Database error {"reason":"policy violation"} Code: 42501'
  );
});

test("formatWorkerError falls back to object JSON instead of object coercion", () => {
  assert.equal(formatWorkerError({ reason: "unknown" }), '{"reason":"unknown"}');
});
