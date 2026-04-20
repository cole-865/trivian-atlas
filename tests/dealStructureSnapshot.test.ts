import test from "node:test";
import assert from "node:assert/strict";
import { getDealStructureSnapshotPti } from "../src/lib/deals/dealStructureSnapshot.js";

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
