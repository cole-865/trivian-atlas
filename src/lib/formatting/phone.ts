export function digitsOnly(value: string | null | undefined) {
  return String(value ?? "").replace(/\D/g, "");
}

export function formatPhoneNumber(value: string | null | undefined) {
  const digits = digitsOnly(value).slice(0, 10);

  if (!digits) return "";
  if (digits.length < 4) return digits;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function normalizePhoneForStorage(value: string | null | undefined) {
  const formatted = formatPhoneNumber(value);
  return formatted || null;
}
