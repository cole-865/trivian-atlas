function toNullableNumber(value: unknown) {
  if (value == null || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getDealStructureSnapshotPti(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }

  const structure = (snapshot as { structure?: { pti?: unknown } }).structure;
  return toNullableNumber(structure?.pti);
}

export function getDealStructureSnapshotAiReview(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }

  const aiReview = (snapshot as { ai_review?: unknown }).ai_review;
  return aiReview ?? null;
}
