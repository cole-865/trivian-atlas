export function dedupeExtractedReportText(text: string): string {
  const t = (text || "").trim();
  if (!t) return t;

  const eqHeader = "Equifax-Style Report Generated";
  const first = t.indexOf(eqHeader);
  if (first !== -1) {
    const second = t.indexOf(eqHeader, first + eqHeader.length);
    if (second !== -1) return t.slice(0, second).trim();
  }

  const mid = Math.floor(t.length / 2);
  const a = t.slice(0, mid).trim();
  const b = t.slice(mid).trim();

  if (a.length > 2000) {
    const probe = a.slice(0, 2000);
    if (b.startsWith(probe)) return a;
  }

  return t;
}

export function buildRedactedPath(rawPath: string, jobId: string): string {
  return rawPath.replace(/\.pdf$/i, "") + `.${jobId}.redacted.pdf`;
}

export function detectBureauFromText(text: string): "equifax" | "unknown" {
  if (/Equifax-Style Report Generated from Equifax v6 Data/i.test(text)) {
    return "equifax";
  }
  if (/FICO Auto v\d+/i.test(text) && /IDENTITY SCAN ALERT/i.test(text)) {
    return "equifax";
  }
  return "unknown";
}

export function resolveJobOrganization(args: {
  jobOrganizationId: string | null | undefined;
  dealOrganizationId: string;
}) {
  if (args.jobOrganizationId) {
    return {
      organizationId: args.jobOrganizationId,
      shouldStampJob: false,
    };
  }

  return {
    organizationId: args.dealOrganizationId,
    shouldStampJob: true,
  };
}
