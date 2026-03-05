// services/credit-worker/src/scrub.ts
//
// Goal: Redact ONLY true PII fields we care about right now.
// Per your requirement: DO NOT blanket-redact dates.
// Only redact DOB when it appears in a DOB-labeled context (BDS/DOB/DATE OF BIRTH).
//
// This is intentionally conservative: it avoids nuking all trade-line dates.

export function scrubPII(input: string): string {
  let t = input ?? "";

  // -----------------------------
  // SSN
  // -----------------------------
  // 123-45-6789
  t = t.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "***-**-****");
  // 9 digits straight (be careful: this can catch non-SSN numeric IDs; but typically safe enough here)
  t = t.replace(/\b\d{9}\b/g, "*********");

  // -----------------------------
  // DOB (ONLY when labeled as DOB)
  // -----------------------------
  // Equifax-style "BDS-05/14/1987" or "BDS: 05/14/1987"
  t = t.replace(
    /(\bBDS\b\s*[-:]\s*)(\d{1,2}\/\d{1,2}\/\d{2,4})/gi,
    "$1**/**/****"
  );

  // "DOB 05/14/1987", "DOB:05/14/1987", "DOB- 05/14/1987"
  t = t.replace(
    /(\bDOB\b\s*[:\-]?\s*)(\d{1,2}\/\d{1,2}\/\d{2,4})/gi,
    "$1**/**/****"
  );

  // "DATE OF BIRTH: 05/14/1987"
  t = t.replace(
    /(\bDATE\s+OF\s+BIRTH\b\s*[:\-]?\s*)(\d{1,2}\/\d{1,2}\/\d{2,4})/gi,
    "$1**/**/****"
  );

  // Sometimes bureaus show DOB with dashes instead: 05-14-1987 (only in DOB context)
  t = t.replace(
    /(\bBDS\b\s*[-:]\s*)(\d{1,2}-\d{1,2}-\d{2,4})/gi,
    "$1**-**-****"
  );
  t = t.replace(
    /(\bDOB\b\s*[:\-]?\s*)(\d{1,2}-\d{1,2}-\d{2,4})/gi,
    "$1**-**-****"
  );
  t = t.replace(
    /(\bDATE\s+OF\s+BIRTH\b\s*[:\-]?\s*)(\d{1,2}-\d{1,2}-\d{2,4})/gi,
    "$1**-**-****"
  );

  // -----------------------------
  // Phone numbers
  // -----------------------------
  // Matches (865) 555-1212, 865-555-1212, 865.555.1212, 865 555 1212, +1 865-555-1212
  t = t.replace(
    /\b(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    "***-***-****"
  );

  // -----------------------------
  // Email addresses
  // -----------------------------
  t = t.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "***@***.***");

  // -----------------------------
  // Optional: Customer name lines (OFF by default)
  // -----------------------------
  // If you decide later you want to redact names, we can add label-based rules like:
  // NAME:, CONSUMER:, SUBJECT:, etc. For now, leave names intact since you didn't ask.

  return t;
}