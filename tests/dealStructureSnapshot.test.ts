import test from "node:test";
import assert from "node:assert/strict";
import {
  getDealStructureSnapshotAiReview,
  getDealStructureSnapshotPti,
} from "../src/lib/deals/dealStructureSnapshot.js";

test("deal structure snapshot pti parses numeric values from persisted snapshot json", () => {
  assert.equal(
    getDealStructureSnapshotPti({
      structure: {
        pti: "0.2184",
      },
    }),
    0.2184
  );
});

test("deal structure snapshot pti returns null when the snapshot has no pti", () => {
  assert.equal(getDealStructureSnapshotPti({ structure: {} }), null);
  assert.equal(getDealStructureSnapshotPti(null), null);
});

test("deal structure snapshot AI review returns persisted review or null", () => {
  const review = {
    summary: "Needs structure review",
    review_source: "deterministic_fallback",
  };

  assert.deepEqual(getDealStructureSnapshotAiReview({ ai_review: review }), review);
  assert.equal(getDealStructureSnapshotAiReview({ ai_review: null }), null);
  assert.equal(getDealStructureSnapshotAiReview({ structure: {} }), null);
});
