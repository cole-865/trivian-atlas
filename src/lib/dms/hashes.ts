import { createHash } from "node:crypto";

export function dmsHashPart(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized || "<null>";
}

export function dmsHash(parts: readonly unknown[]) {
  return createHash("sha256").update(parts.map(dmsHashPart).join("|")).digest("hex");
}

export function transactionHash(row: Record<string, string>) {
  return dmsHash([
    row["Deal Identifier"],
    row["Paid Date"],
    row["Paid Amount"],
    "",
    row["Transaction Type"],
    row["Reference Number"],
    row["Last Updated Date"],
    "",
    row["Period Number"],
  ]);
}

export function activityEventHash(row: Record<string, string>) {
  return dmsHash([
    row["Account Number"],
    row["Customer Name"],
    row["Created Date"],
    row["Activity Type"],
    row["Activity Status"],
    row["Disposition"],
    row["Subject"],
    row["Last Updated Date"],
  ]);
}
