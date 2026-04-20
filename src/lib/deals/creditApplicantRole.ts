export const CREDIT_APPLICANT_ROLES = ["primary", "co"] as const;

export type CreditApplicantRole = (typeof CREDIT_APPLICANT_ROLES)[number];

export function isCreditApplicantRole(value: unknown): value is CreditApplicantRole {
  return value === "primary" || value === "co";
}

export function parseCreditApplicantRole(value: unknown): CreditApplicantRole | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return isCreditApplicantRole(normalized) ? normalized : null;
}

export function getCreditApplicantRole(
  value: unknown,
  fallback: CreditApplicantRole = "primary"
): CreditApplicantRole {
  return parseCreditApplicantRole(value) ?? fallback;
}
