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
