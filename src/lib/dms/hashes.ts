import { createHash } from "node:crypto";

export function dmsHashPart(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized || "<null>";
}

export function dmsHash(parts: readonly unknown[]) {
  return createHash("sha256").update(parts.map(dmsHashPart).join("|")).digest("hex");
}

export function transactionHashBase(row: Record<string, string>) {
  return [
    row["Deal Identifier"],
    row["Paid Date"],
    row["Paid Amount"],
    row["Transaction Type"],
    row["Reference Number"],
    row["Last Updated Date"],
    row["Period Number"],
    row["Principal Applied Amount"],
    row["Interest Applied Amount"],
    row["Late Fees Applied Amount"],
    row["Other Fees Applied Amount"],
    row["Side Note Applied Amount"],
    row["Down Applied Amount"],
    row["Credit Applied Amount"],
    row["Balance Amount"],
    row["Due Amount"],
    row["Days Late"],
    row["Late Fee Amount"],
    row["Principal Due Amount"],
    row["Interest Due Amount"],
    row["Other Fees Due Amount"],
    row["Side Note Due Amount"],
    row["Processing Fee Due Amount"],
  ];
}

export function transactionHash(
  row: Record<string, string>,
  occurrenceIndex = 1
) {
  return dmsHash([...transactionHashBase(row), `occurrence:${occurrenceIndex}`]);
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
