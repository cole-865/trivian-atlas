import { supabase } from "./supabase.js";
import type {
  BureauMessageRow,
  BureauPublicRecordRow,
  BureauTradelineRow,
} from "./parseEquifax.js";

export type CreditReportJobRow = {
  applicant_role?: "primary" | "co" | null;
  id: string;
  deal_id: string;
  organization_id?: string | null;
  uploaded_by?: string | null;
  raw_bucket: string;
  raw_path: string;
};

export type ParsedBureauReport = {
  bureau: string;
  summary: Record<string, unknown>;
  tradelines: BureauTradelineRow[];
  publicRecords: BureauPublicRecordRow[];
  messages: BureauMessageRow[];
};

export type UnderwriteResult = {
  decision: "approved" | "denied";
  tier: "A" | "B" | "C" | "D" | "BHPH" | null;
  scoreTotal: number;
  hardStop: boolean;
  hardStopReason: string | null;
  maxTermMonths: number | null;
  minCashDown: number | null;
  minDownPct: number | null;
  maxPti: number | null;
  maxAmountFinanced: number | null;
  maxVehiclePrice: number | null;
  maxLtv: number | null;
  apr: number | null;
  scoreFactors: Array<{
    code: string;
    points: number;
    note: string;
  }>;
  notes: string;
};

export type CreditWorkerGateway = {
  getDealOrganizationId: (dealId: string) => Promise<string>;
  stampJobOrganization: (jobId: string, organizationId: string) => Promise<void>;
  updateJobStatus: (
    jobId: string,
    status: "parsing" | "redacting" | "scoring" | "done" | "failed",
    extras?: Record<string, unknown>
  ) => Promise<void>;
  markJobFailed: (jobId: string, err: unknown) => Promise<void>;
  downloadRawPdf: (bucket: string, path: string) => Promise<Buffer>;
  uploadRedactedPdf: (bucket: string, path: string, body: Uint8Array) => Promise<void>;
  upsertCreditReport: (args: {
    applicantRole: "primary" | "co";
    organizationId: string;
    dealId: string;
    jobId: string;
    bureau: string;
    rawBucket: string;
    rawPath: string;
    redactedBucket: string;
    redactedPath: string;
    redactedText: string;
  }) => Promise<{ id: string } & Record<string, unknown>>;
  upsertBureauSummary: (args: {
    applicantRole: "primary" | "co";
    organizationId: string;
    dealId: string;
    creditReportId: string;
    jobId: string;
    parsed: ParsedBureauReport;
  }) => Promise<{ id: string; score: number | null; repo_count?: number | null; months_since_repo?: number | null; paid_auto_trades?: number | null; open_auto_trades?: number | null } & Record<string, unknown>>;
  replaceBureauDetails: (args: {
    applicantRole: "primary" | "co";
    organizationId: string;
    bureauSummaryId: string;
    dealId: string;
    tradelines: BureauTradelineRow[];
    publicRecords: BureauPublicRecordRow[];
    messages: BureauMessageRow[];
  }) => Promise<void>;
  loadApplicantPerson: (
    organizationId: string,
    dealId: string,
    applicantRole: "primary" | "co"
  ) => Promise<{ residence_months: number | null }>;
  upsertUnderwritingResult: (args: {
    organizationId: string;
    dealId: string;
    uploadedBy: string | null;
    result: UnderwriteResult;
  }) => Promise<void>;
};

function formatWorkerError(err: unknown) {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}`;
  }

  if (err && typeof err === "object") {
    const candidate = err as {
      details?: string | null;
      error?: string | null;
      message?: string | null;
    };

    return (
      candidate.details ||
      candidate.message ||
      candidate.error ||
      JSON.stringify(candidate)
    );
  }

  return String(err);
}

export const defaultCreditWorkerGateway: CreditWorkerGateway = {
  async getDealOrganizationId(dealId) {
    const { data, error } = await supabase
      .from("deals")
      .select("organization_id")
      .eq("id", dealId)
      .maybeSingle();

    if (error) throw error;

    const organizationId = data?.organization_id ?? null;
    if (!organizationId) {
      throw new Error(`Deal ${dealId} is missing organization_id`);
    }

    return organizationId;
  },

  async stampJobOrganization(jobId, organizationId) {
    const { error } = await supabase
      .from("credit_report_jobs")
      .update({ organization_id: organizationId })
      .eq("id", jobId);

    if (error) throw error;
  },

  async updateJobStatus(jobId, status, extras = {}) {
    const { error } = await supabase
      .from("credit_report_jobs")
      .update({
        status,
        ...extras,
      })
      .eq("id", jobId);

    if (error) throw error;
  },

  async markJobFailed(jobId, err) {
    const message = formatWorkerError(err);

    const { error } = await supabase
      .from("credit_report_jobs")
      .update({
        status: "failed",
        error_message: message,
        processed_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    if (error) {
      console.error("[credit-worker] failed to update job as failed:", jobId, error);
    }
  },

  async downloadRawPdf(bucket, path) {
    const dl = await supabase.storage.from(bucket).download(path);
    if (dl.error) throw dl.error;
    if (!dl.data) throw new Error("Storage download returned no data");
    return Buffer.from(await dl.data.arrayBuffer());
  },

  async uploadRedactedPdf(bucket, path, body) {
    const uploadRes = await supabase.storage.from(bucket).upload(path, body, {
      contentType: "application/pdf",
      upsert: true,
    });

    if (uploadRes.error) throw uploadRes.error;
  },

  async upsertCreditReport(args) {
    const payload = {
      applicant_role: args.applicantRole,
      organization_id: args.organizationId,
      deal_id: args.dealId,
      bureau: args.bureau,
      raw_bucket: args.rawBucket,
      raw_path: args.rawPath,
      redacted_bucket: args.redactedBucket,
      redacted_path: args.redactedPath,
      redacted_text: args.redactedText,
      latest_job_id: args.jobId,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("credit_reports")
      .upsert(payload, { onConflict: "organization_id,deal_id,applicant_role" })
      .select("*")
      .single();

    if (error) throw error;
    return data;
  },

  async upsertBureauSummary(args) {
    const s = args.parsed.summary;
    const payload = {
      applicant_role: args.applicantRole,
      organization_id: args.organizationId,
      deal_id: args.dealId,
      credit_report_id: args.creditReportId,
      job_id: args.jobId,
      bureau_source: s.bureau_source,
      score: s.score,
      total_tradelines: s.total_tradelines,
      open_tradelines: s.open_tradelines,
      open_auto_trade: s.open_auto_trade,
      months_since_repo: s.months_since_repo,
      months_since_bankruptcy: s.months_since_bankruptcy,
      total_collections: s.total_collections,
      total_chargeoffs: s.total_chargeoffs,
      past_due_amount: s.past_due_amount,
      utilization_pct: s.utilization_pct,
      oldest_trade_months: s.oldest_trade_months,
      autos_on_bureau: s.autos_on_bureau,
      open_auto_trades: s.open_auto_trades,
      paid_auto_trades: s.paid_auto_trades,
      repo_count: s.repo_count,
      risk_tier: s.risk_tier,
      max_term_months: s.max_term_months,
      min_cash_down: s.min_cash_down,
      max_pti: s.max_pti,
      hard_stop: s.hard_stop,
      hard_stop_reason: s.hard_stop_reason,
      stips: s.stips,
      bureau_raw: s.bureau_raw,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("bureau_summary")
      .upsert(payload, { onConflict: "credit_report_id" })
      .select("*")
      .single();

    if (error) throw error;
    return data;
  },

  async replaceBureauDetails(args) {
    const { error: delTradelinesErr } = await supabase
      .from("bureau_tradelines")
      .delete()
      .eq("organization_id", args.organizationId)
      .eq("bureau_summary_id", args.bureauSummaryId)
      .eq("applicant_role", args.applicantRole);
    if (delTradelinesErr) throw delTradelinesErr;

    const { error: delPublicErr } = await supabase
      .from("bureau_public_records")
      .delete()
      .eq("organization_id", args.organizationId)
      .eq("bureau_summary_id", args.bureauSummaryId)
      .eq("applicant_role", args.applicantRole);
    if (delPublicErr) throw delPublicErr;

    const { error: delMessagesErr } = await supabase
      .from("bureau_messages")
      .delete()
      .eq("organization_id", args.organizationId)
      .eq("bureau_summary_id", args.bureauSummaryId)
      .eq("applicant_role", args.applicantRole);
    if (delMessagesErr) throw delMessagesErr;

    if (args.tradelines.length > 0) {
      const { error } = await supabase.from("bureau_tradelines").insert(
        args.tradelines.map((t) => ({
          applicant_role: args.applicantRole,
          organization_id: args.organizationId,
          bureau_summary_id: args.bureauSummaryId,
          deal_id: args.dealId,
          creditor_name: t.creditor_name,
          account_type: t.account_type,
          account_status: t.account_status,
          condition_code: t.condition_code,
          amount: t.amount,
          balance: t.balance,
          credit_limit: t.credit_limit,
          monthly_payment: t.monthly_payment,
          past_due_amount: t.past_due_amount,
          high_balance: t.high_balance,
          opened_date: t.opened_date,
          last_activity_date: t.last_activity_date,
          last_payment_date: t.last_payment_date,
          no_effect: t.no_effect,
          good: t.good,
          bad: t.bad,
          auto_repo: t.auto_repo,
          unpaid_collection: t.unpaid_collection,
          unpaid_chargeoff: t.unpaid_chargeoff,
          is_auto: t.is_auto,
          is_revolving: t.is_revolving,
          is_installment: t.is_installment,
          raw_segment: t.raw_segment ?? {},
          updated_at: new Date().toISOString(),
        }))
      );
      if (error) throw error;
    }

    if (args.publicRecords.length > 0) {
      const { error } = await supabase.from("bureau_public_records").insert(
        args.publicRecords.map((r) => ({
          applicant_role: args.applicantRole,
          organization_id: args.organizationId,
          bureau_summary_id: args.bureauSummaryId,
          deal_id: args.dealId,
          court_name: r.court_name,
          record_type: r.record_type,
          plaintiff: r.plaintiff,
          amount: r.amount,
          status: r.status,
          filed_date: r.filed_date,
          resolved_date: r.resolved_date,
          no_effect: r.no_effect,
          good: r.good,
          bad: r.bad,
          raw_segment: r.raw_segment ?? {},
          updated_at: new Date().toISOString(),
        }))
      );
      if (error) throw error;
    }

    if (args.messages.length > 0) {
      const { error } = await supabase.from("bureau_messages").insert(
        args.messages.map((m) => ({
          applicant_role: args.applicantRole,
          organization_id: args.organizationId,
          bureau_summary_id: args.bureauSummaryId,
          deal_id: args.dealId,
          message_type: m.message_type,
          code: m.code,
          message_text: m.message_text,
          severity: m.severity,
        }))
      );
      if (error) throw error;
    }
  },

  async loadApplicantPerson(organizationId, dealId, applicantRole) {
    const { data, error } = await supabase
      .from("deal_people")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("deal_id", dealId)
      .eq("role", applicantRole)
      .single();

    if (error) throw error;
    return {
      residence_months: data.residence_months ?? null,
    };
  },

  async upsertUnderwritingResult(args) {
    const { error } = await supabase.from("underwriting_results").upsert(
      {
        organization_id: args.organizationId,
        deal_id: args.dealId,
        user_id: args.uploadedBy,
        stage: "bureau_precheck",
        score_total: args.result.scoreTotal,
        decision: args.result.decision,
        notes: args.result.notes,
        tier: args.result.tier,
        max_term_months: args.result.maxTermMonths,
        min_cash_down: args.result.minCashDown,
        min_down_pct: args.result.minDownPct,
        max_pti: args.result.maxPti,
        max_amount_financed: args.result.maxAmountFinanced,
        max_vehicle_price: args.result.maxVehiclePrice,
        max_ltv: args.result.maxLtv,
        apr: args.result.apr,
        hard_stop: args.result.hardStop,
        hard_stop_reason: args.result.hardStopReason,
        score_factors: args.result.scoreFactors,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "deal_id,stage" }
    );

    if (error) throw error;
  },
};
