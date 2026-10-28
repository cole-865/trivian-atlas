import { z } from "zod";

export const categories = ["sales", "service", "mixed", "vendor", "payments", "accounts_payable", "collections", "internal", "personal", "unknown"] as const;
export const categorySchema = z.enum(categories);
export type Category = z.infer<typeof categorySchema>;
export const reviewStatuses = ["needs_review", "in_review", "coaching_assigned", "resolved"] as const;
export const rubricVersion = "pilot-1";
export const criteria = ["professionalism", "understanding", "accuracy", "communication", "next_steps", "closing"] as const;
export const rubrics = {
  sales: {
    inbound: [10, 20, 15, 20, 25, 10],
    outbound: [10, 20, 15, 15, 30, 10],
  },
  service: {
    inbound: [10, 25, 15, 20, 20, 10],
    outbound: [10, 15, 20, 25, 20, 10],
  },
} as const;

const identifier = z.string().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/);
export const callInputSchema = z.object({
  providerCallId: identifier,
  recordingId: identifier.nullable(),
  employeeId: identifier.nullable(),
  startedAt: z.iso.datetime({ offset: true }),
  direction: z.enum(["inbound", "outbound"]),
  durationSeconds: z.number().int().min(0).max(14400),
  connected: z.boolean(),
  consent: z.enum(["approved", "unknown", "denied"]),
  consentReference: z.string().min(1).max(160).nullable(),
  redacted: z.boolean(),
  transcriptConfidence: z.number().min(0).max(1),
  transcript: z.array(z.object({
    start: z.number().min(0), end: z.number().min(0),
    speaker: z.enum(["employee", "customer", "unknown"]),
    text: z.string().min(1).max(4000),
  }).strict()).max(500),
}).strict().superRefine((call, ctx) => {
  if (call.transcript.some((s, i) => s.end < s.start || s.end > call.durationSeconds || (i > 0 && s.start < call.transcript[i - 1].start))) {
    ctx.addIssue({ code: "custom", message: "Invalid transcript timestamps" });
  }
  if (call.consent !== "approved" && call.transcript.length) {
    ctx.addIssue({ code: "custom", message: "Send metadata only until consent is verified" });
  }
});
export type CallInput = z.infer<typeof callInputSchema>;

const evidence = z.object({
  criterion: z.enum(criteria),
  rating: z.number().int().min(0).max(4).nullable(),
  reason: z.string().min(1).max(400),
  atSeconds: z.number().min(0).nullable(),
}).strict();
export const assessmentSchema = z.object({
  category: categorySchema,
  classificationConfidence: z.number().min(0).max(1),
  gradingConfidence: z.number().min(0).max(1),
  sufficientEvidence: z.boolean(),
  summary: z.string().max(1000),
  criteria: z.array(evidence).max(6),
  criticalFlags: z.array(z.object({
    code: z.enum(["abusive_behavior", "misleading_promise", "serious_unresolved_complaint", "legal_threat", "privacy_exposure"]),
    reason: z.string().min(1).max(400), atSeconds: z.number().min(0),
  }).strict()).max(10),
}).strict();
export type Assessment = z.infer<typeof assessmentSchema>;
export type Evaluation = {
  category: Category; score: number | null; reasons: string[];
  state: "graded" | "excluded" | "manual_review" | "not_evaluable";
  assessment: Assessment | null; rubricVersion: string;
};
export function requiresManagementReview(evaluation: Evaluation) {
  return evaluation.reasons.some(reason => reason !== "unanswered" && reason !== "no_recording");
}
export function isEligible(category: Category): category is "sales" | "service" {
  return category === "sales" || category === "service";
}
export function isExcluded(category: Category) {
  return !isEligible(category) && category !== "mixed" && category !== "unknown";
}

export function preflight(call: CallInput): string[] {
  if (call.consent !== "approved" || !call.consentReference) return ["consent_unverified"];
  if (!call.connected) return ["unanswered"];
  if (!call.recordingId) return ["no_recording"];
  if (!call.redacted) return ["redaction_unverified"];
  if (!call.transcript.length || !call.durationSeconds) return ["no_usable_transcript"];
  return [];
}

export function evaluate(call: CallInput, raw: unknown, threshold: number): Evaluation {
  if (!Number.isFinite(threshold) || threshold < 0.5 || threshold > 1) throw new Error("Invalid confidence threshold");
  const blocked = preflight(call);
  if (blocked.length) return { category: "unknown", score: null, reasons: blocked, state: "not_evaluable", assessment: null, rubricVersion };
  const assessment = assessmentSchema.parse(raw);
  if (new Set(assessment.criteria.map(c => c.criterion)).size !== assessment.criteria.length ||
    assessment.criteria.some(c => c.atSeconds !== null && c.atSeconds > call.durationSeconds) ||
    assessment.criticalFlags.some(c => c.atSeconds > call.durationSeconds)) throw new Error("Invalid assessment evidence");
  const reasons: string[] = [];
  if (assessment.criticalFlags.length) reasons.push("critical_flag");
  if (assessment.classificationConfidence < threshold || call.transcriptConfidence < threshold) reasons.push("low_confidence");
  // Uncertain exclusions are reviewed, never silently discarded.
  if (isExcluded(assessment.category) && !reasons.includes("low_confidence")) {
    return { category: assessment.category, score: null, reasons, state: "excluded", assessment: null, rubricVersion };
  }
  if (!isEligible(assessment.category)) reasons.push("classification_review");
  if (assessment.gradingConfidence < threshold && !reasons.includes("low_confidence")) reasons.push("low_confidence");
  if (!assessment.sufficientEvidence) reasons.push("insufficient_evidence");
  if (!call.employeeId) reasons.push("employee_unmapped");
  let score: number | null = null;
  if (isEligible(assessment.category)) {
    if (assessment.criteria.length !== criteria.length) throw new Error("Incomplete rubric");
    let earned = 0, possible = 0;
    for (const item of assessment.criteria) {
      if (item.rating === null) continue; // Context-specific N/A, never zero points.
      if (item.atSeconds === null) throw new Error("Scored criteria require evidence timestamps");
      const weight = rubrics[assessment.category][call.direction][criteria.indexOf(item.criterion)];
      possible += weight;
      earned += weight * item.rating / 4;
    }
    if (!possible && !reasons.includes("insufficient_evidence")) reasons.push("insufficient_evidence");
    if (!reasons.some(r => r !== "critical_flag") && possible) score = Math.round(100 * earned / possible);
  }
  if (score !== null && score < 70) reasons.push("below_70");
  return { category: assessment.category, score, reasons, state: score === null ? "manual_review" : "graded", assessment, rubricVersion };
}

export type Analyzer = (call: CallInput) => Promise<unknown>;
export async function analyzeCall(call: CallInput, analyzer: Analyzer, threshold: number): Promise<Evaluation> {
  if (preflight(call).length) return evaluate(call, null, threshold);
  return evaluate(call, await analyzer(call), threshold);
}

export const correctionSchema = z.object({
  expectedRevision: z.number().int().min(1),
  category: categorySchema,
  score: z.number().int().min(0).max(100).nullable(),
  status: z.enum(reviewStatuses),
  reason: z.string().trim().min(5).max(1000),
}).strict().refine(v => isEligible(v.category) || v.score === null, "Excluded and unclear calls cannot have a score");

export type CallRecord = {
  id: string; organization_id: string; provider_call_id: string; employee_id: string | null;
  direction: "inbound" | "outbound"; started_at: string; category: Category; score: number | null;
  ai_category: Category; ai_score: number | null; evaluation: Evaluation;
  status: "not_required" | typeof reviewStatuses[number]; revision: number;
  expires_at: string; created_at: string;
};

export function coachingTrends(rows: CallRecord[], now = Date.now()) {
  const groups = new Map<string, { employee: string; count: number; total: number; below70: number; opportunities: number; critical: number }>();
  for (const row of rows) {
    const time = Date.parse(row.started_at);
    if (!row.employee_id || !isEligible(row.category) || row.score === null || time > now || time < now - 7 * 86400000 || Date.parse(row.expires_at) <= now) continue;
    const key = row.employee_id;
    const group = groups.get(key) ?? { employee: key, count: 0, total: 0, below70: 0, opportunities: 0, critical: 0 };
    group.count++; group.total += row.score;
    if (row.score < 70) group.below70++;
    if (row.score < 85) group.opportunities++;
    if (row.evaluation.reasons.includes("critical_flag")) group.critical++;
    groups.set(key, group);
  }
  return [...groups.values()].map(g => ({ ...g, average: Math.round(g.total / g.count) }));
}
