export type SourceReview = { reportKey: string; issueCode: string; owner: string; notes: string; status: "open" | "in_review" };
export function parseSourceReview(value: unknown): SourceReview | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (typeof r.reportKey !== "string" || !r.reportKey || r.reportKey.length > 160 ||
      typeof r.issueCode !== "string" || !r.issueCode || r.issueCode.length > 200 ||
      typeof r.owner !== "string" || r.owner.length > 160 ||
      typeof r.notes !== "string" || r.notes.length > 2000 ||
      (r.status !== "open" && r.status !== "in_review")) return null;
  return { reportKey:r.reportKey,issueCode:r.issueCode,owner:r.owner,notes:r.notes,status:r.status };
}

// Next standalone may construct nextUrl with the internal bind host. Compare
// the browser Origin with the request Host that the reverse proxy preserves.
export function isSameOriginReview(origin:string|null,host:string|null) {
 if(!origin || !host) return false;
 try {const url=new URL(origin);return ["http:","https:"].includes(url.protocol) && url.origin===origin && url.host===host;}
 catch {return false;}
}
