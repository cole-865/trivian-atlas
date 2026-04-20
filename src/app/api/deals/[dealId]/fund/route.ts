import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthContext } from "@/lib/auth/userRole";
import { hasDealershipPermission } from "@/lib/auth/dealershipPermissions";
import { canAccessStep } from "@/lib/deals/canAccessStep";
import {
  getDealForCurrentOrganization,
  NO_CURRENT_ORGANIZATION_MESSAGE,
} from "@/lib/deals/organizationScope";
import { buildOverrideStructureSnapshot } from "@/lib/deals/dealOverrideWorkflow";
import { loadDealOverrideSnapshot } from "@/lib/deals/dealOverrideServer";
import { createDealFundingOutcomeNotifications } from "@/lib/notifications/appNotifications";
import { sendDealFundingOutcomeEmail } from "@/lib/email/notifications";

type RequiredDocType = "proof_of_income" | "proof_of_residence" | "driver_license";
type FundingStipStatus = "verified" | "rejected";

type DealDocument = {
  id: string;
  deal_id: string;
  doc_type: string;
  storage_bucket: string;
  storage_path: string;
  original_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
};

type FundingVerification = {
  id: string;
  doc_type: RequiredDocType;
  status: FundingStipStatus;
  rejection_reason: string | null;
  verified_monthly_income: number | null;
  structure_fingerprint: string;
  verified_by: string | null;
  verified_at: string;
};

type DealPerson = {
  id: string;
  role: string;
  first_name: string | null;
  last_name: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  residence_months: number | null;
  move_in_date: string | null;
};

type IncomeProfile = {
  id: string;
  deal_person_id: string;
  income_type: string | null;
  applied_to_deal: boolean;
  monthly_gross_calculated: number | null;
  monthly_gross_manual: number | null;
  pay_frequency: string | null;
  hire_date: string | null;
};

const REQUIRED_DOC_TYPES: RequiredDocType[] = [
  "proof_of_income",
  "proof_of_residence",
  "driver_license",
];

function emptyGroupedDocuments() {
  return {
    credit_bureau: null as DealDocument | null,
    proof_of_income: [] as DealDocument[],
    proof_of_residence: [] as DealDocument[],
    driver_license: [] as DealDocument[],
    insurance: [] as DealDocument[],
    references: [] as DealDocument[],
    other: [] as DealDocument[],
  };
}

function isRequiredDocType(value: unknown): value is RequiredDocType {
  return REQUIRED_DOC_TYPES.includes(value as RequiredDocType);
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "not entered";
  return Number(value).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function formatPersonName(person: DealPerson | null) {
  const name = [person?.first_name, person?.last_name].filter(Boolean).join(" ").trim();
  return name || "Customer name on file";
}

function formatAddress(person: DealPerson | null) {
  const parts = [
    person?.address_line1,
    person?.address_line2,
    [person?.city, person?.state].filter(Boolean).join(", "),
    person?.zip,
  ]
    .filter(Boolean)
    .map((part) => String(part).trim())
    .filter(Boolean);

  return parts.length ? parts.join(" ") : "No address entered";
}

function formatResidence(person: DealPerson | null) {
  const months = person?.residence_months;
  if (months == null) return "No time at residence entered";

  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  const parts = [
    years ? `${years} year${years === 1 ? "" : "s"}` : "",
    remainingMonths ? `${remainingMonths} month${remainingMonths === 1 ? "" : "s"}` : "",
  ].filter(Boolean);

  return parts.length ? parts.join(", ") : "0 months";
}

function monthlyIncome(row: IncomeProfile) {
  return num(row.monthly_gross_calculated) ?? num(row.monthly_gross_manual) ?? 0;
}

function getSnapshotPti(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const structure = (snapshot as { structure?: { pti?: unknown } }).structure;
  const pti = num(structure?.pti);
  return pti;
}

async function notifyFundingOutcome(args: {
  organizationId: string;
  dealId: string;
  dealNumber: string | null;
  customerName: string | null;
  salespersonUserId: string | null;
  submittedByUserId: string | null;
  outcome: "funded" | "funded_with_changes" | "rejected" | "restructure_requested";
  reason?: string | null;
  verifiedMonthlyIncome?: number | null;
}) {
  await createDealFundingOutcomeNotifications({
    organizationId: args.organizationId,
    dealId: args.dealId,
    dealNumber: args.dealNumber,
    customerName: args.customerName,
    salespersonUserId: args.salespersonUserId,
    submittedByUserId: args.submittedByUserId,
    outcome:
      args.outcome === "rejected" || args.outcome === "restructure_requested"
        ? "rejected"
        : "funded",
    reason: args.reason,
  });

  const emailResult = await sendDealFundingOutcomeEmail(args);
  if (!emailResult.sent && emailResult.reason) {
    console.warn("deal funding outcome email not sent:", emailResult.reason);
  }
}

function buildStipTargets(args: {
  primary: DealPerson | null;
  people: DealPerson[];
  incomes: IncomeProfile[];
}) {
  const appliedIncomes = args.incomes.filter((income) => income.applied_to_deal);
  const peopleById = new Map(args.people.map((person) => [person.id, person]));
  const incomeLines = appliedIncomes.length
    ? appliedIncomes.map((income) => {
        const person = peopleById.get(income.deal_person_id) ?? null;
        const type = income.income_type?.replace(/_/g, " ") || "income";
        const frequency = income.pay_frequency ? `, ${income.pay_frequency}` : "";
        const hireDate = income.hire_date ? `, hire date ${income.hire_date}` : "";
        return `${formatPersonName(person)} ${type}: ${money(monthlyIncome(income))} monthly${frequency}${hireDate}`;
      })
    : ["No applied income profiles are on file."];

  return {
    proof_of_income: incomeLines,
    proof_of_residence: [
      `Address matches ${formatAddress(args.primary)}.`,
      `Time at residence is ${formatResidence(args.primary)}.`,
    ],
    driver_license: [
      `Name matches ${formatPersonName(args.primary)}.`,
      `Address matches ${formatAddress(args.primary)}.`,
    ],
  } satisfies Record<RequiredDocType, string[]>;
}

async function loadFundingPacket(supabase: Awaited<ReturnType<typeof supabaseServer>>, dealId: string) {
  const { data: deal, error: dealErr, organizationId } =
    await getDealForCurrentOrganization<{
      id: string;
      approval_number: string | null;
      customer_name: string | null;
      workflow_status: string | null;
      submit_status: string | null;
      funding_notes: string | null;
      funding_status: string | null;
      funding_decision_notes: string | null;
      internal_notes: string | null;
      submitted_at: string | null;
      submitted_by: string | null;
      funded_at: string | null;
      funded_by: string | null;
      user_id: string | null;
    }>(
      supabase,
      dealId,
      `
        id,
        approval_number,
        customer_name,
        workflow_status,
        submit_status,
        funding_notes,
        funding_status,
        funding_decision_notes,
        internal_notes,
        submitted_at,
        submitted_by,
        funded_at,
        funded_by,
        user_id
      `
    );

  if (!organizationId) {
    return { errorResponse: NextResponse.json({ error: NO_CURRENT_ORGANIZATION_MESSAGE }, { status: 400 }) };
  }

  if (dealErr) {
    return {
      errorResponse: NextResponse.json(
        { error: "Failed to load deal", details: dealErr.message },
        { status: 500 }
      ),
    };
  }

  if (!deal?.id) {
    return { errorResponse: NextResponse.json({ error: "Deal not found" }, { status: 404 }) };
  }

  const { data: underwritingResult, error: underwritingErr } = await supabase
    .from("underwriting_results")
    .select("decision")
    .eq("organization_id", organizationId)
    .eq("deal_id", dealId)
    .eq("stage", "bureau_precheck")
    .maybeSingle();

  if (underwritingErr) {
    return {
      errorResponse: NextResponse.json(
        { error: "Failed to load underwriting result", details: underwritingErr.message },
        { status: 500 }
      ),
    };
  }

  const { data: structure, error: structureErr } = await supabase
    .from("deal_structure")
    .select(
      `
        deal_id,
        vehicle_id,
        option_label,
        include_vsc,
        include_gap,
        sale_price,
        cash_down,
        trade_payoff,
        jd_power_retail_book,
        taxable_amount,
        sales_tax,
        doc_fee,
        title_license,
        fees_total,
        product_total,
        vsc_price,
        gap_price,
        amount_financed,
        apr,
        term_months,
        monthly_payment,
        ltv,
        fits_program,
        fail_reasons,
        snapshot_json,
        created_at,
        updated_at
      `
    )
    .eq("organization_id", organizationId)
    .eq("deal_id", dealId)
    .maybeSingle();

  if (structureErr) {
    return {
      errorResponse: NextResponse.json(
        { error: "Failed to load deal structure", details: structureErr.message },
        { status: 500 }
      ),
    };
  }

  const overrideSnapshot = structure
    ? await loadDealOverrideSnapshot({
        organizationId,
        dealId,
        customerName: deal.customer_name,
        failReasons: structure.fail_reasons ?? [],
        liveStructure: buildOverrideStructureSnapshot({
          vehicleId: structure.vehicle_id,
          cashDown: structure.cash_down,
          amountFinanced: structure.amount_financed,
          monthlyPayment: structure.monthly_payment,
          termMonths: structure.term_months,
          ltv: structure.ltv,
          pti: getSnapshotPti(structure.snapshot_json),
        }),
      })
    : null;

  const access = await canAccessStep({
    supabase,
    step: "fund",
    deal: {
      status: deal.workflow_status,
      selected_vehicle_id: structure?.vehicle_id ?? null,
      submit_status: deal.submit_status,
      submitted_at: deal.submitted_at,
    },
    underwriting: {
      decision: underwritingResult?.decision ?? null,
    },
  });

  if (!access.allowed) {
    return {
      errorResponse: NextResponse.json(
        {
          ok: false,
          error: "STEP_BLOCKED",
          redirectTo: access.redirectTo ?? "submit",
          reason: access.reason,
        },
        { status: 403 }
      ),
    };
  }

  if (overrideSnapshot?.effectiveBlockers.length) {
    return {
      errorResponse: NextResponse.json(
        {
          ok: false,
          error: "STEP_BLOCKED",
          redirectTo: "deal",
          reason: `Program blockers unresolved: ${overrideSnapshot.effectiveBlockers.join(", ")}`,
        },
        { status: 403 }
      ),
    };
  }

  const { data: docs, error: docsErr } = await supabase
    .from("deal_documents")
    .select(
      `
        id,
        deal_id,
        doc_type,
        storage_bucket,
        storage_path,
        original_name,
        mime_type,
        size_bytes,
        created_at
      `
    )
    .eq("organization_id", organizationId)
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false });

  if (docsErr) {
    return {
      errorResponse: NextResponse.json(
        { error: "Failed to load documents", details: docsErr.message },
        { status: 500 }
      ),
    };
  }

  const { data: people, error: peopleErr } = await supabase
    .from("deal_people")
    .select(
      "id, role, first_name, last_name, address_line1, address_line2, city, state, zip, residence_months, move_in_date"
    )
    .eq("organization_id", organizationId)
    .eq("deal_id", dealId)
    .order("created_at", { ascending: true });

  if (peopleErr) {
    return {
      errorResponse: NextResponse.json(
        { error: "Failed to load deal people", details: peopleErr.message },
        { status: 500 }
      ),
    };
  }

  const personRows = (people ?? []) as DealPerson[];
  const primary = personRows.find((person) => person.role === "primary") ?? personRows[0] ?? null;
  const personIds = personRows.map((person) => person.id);
  const incomeQuery = supabase
    .from("income_profiles")
    .select(
      "id, deal_person_id, income_type, applied_to_deal, monthly_gross_calculated, monthly_gross_manual, pay_frequency, hire_date"
    )
    .eq("organization_id", organizationId);

  const incomeResponse = personIds.length
    ? await incomeQuery.in("deal_person_id", personIds)
    : { data: [] as IncomeProfile[], error: null };

  if (incomeResponse.error) {
    return {
      errorResponse: NextResponse.json(
        { error: "Failed to load income profiles", details: incomeResponse.error.message },
        { status: 500 }
      ),
    };
  }

  const { data: verifications, error: verificationsErr } = await supabase
    .from("deal_funding_stip_verifications")
    .select("id, doc_type, status, rejection_reason, verified_monthly_income, structure_fingerprint, verified_by, verified_at")
    .eq("organization_id", organizationId)
    .eq("deal_id", dealId);

  if (verificationsErr) {
    return {
      errorResponse: NextResponse.json(
        { error: "Failed to load funding verifications", details: verificationsErr.message },
        { status: 500 }
      ),
    };
  }

  const grouped = emptyGroupedDocuments();
  for (const doc of (docs ?? []) as DealDocument[]) {
    if (doc.doc_type === "credit_bureau") {
      if (!grouped.credit_bureau) grouped.credit_bureau = doc;
    } else if (doc.doc_type === "proof_of_income") {
      grouped.proof_of_income.push(doc);
    } else if (doc.doc_type === "proof_of_residence") {
      grouped.proof_of_residence.push(doc);
    } else if (doc.doc_type === "driver_license") {
      grouped.driver_license.push(doc);
    } else if (doc.doc_type === "insurance") {
      grouped.insurance.push(doc);
    } else if (doc.doc_type === "references") {
      grouped.references.push(doc);
    } else {
      grouped.other.push(doc);
    }
  }

  const uploadedTypes = new Set((docs ?? []).map((doc) => doc.doc_type));
  const missingRequiredDocs = REQUIRED_DOC_TYPES.filter((docType) => !uploadedTypes.has(docType));
  const targets = buildStipTargets({
    primary,
    people: personRows,
    incomes: (incomeResponse.data ?? []) as IncomeProfile[],
  });
  const currentFingerprint = overrideSnapshot?.currentFingerprint ?? null;
  const verificationLookup = new Map(
    ((verifications ?? []) as FundingVerification[]).map((verification) => [
      verification.doc_type,
      verification,
    ])
  );
  const stips = REQUIRED_DOC_TYPES.map((docType) => {
    const verification = verificationLookup.get(docType) ?? null;
    return {
      doc_type: docType,
      label:
        docType === "proof_of_income"
          ? "Proof of Income"
          : docType === "proof_of_residence"
            ? "Proof of Residence"
            : "Driver License",
      documents: grouped[docType],
      targets: targets[docType],
      verification,
      is_current: !!verification && verification.structure_fingerprint === currentFingerprint,
    };
  });
  const requiredStipsVerified = stips.every(
    (stip) =>
      stip.documents.length > 0 &&
      stip.verification?.status === "verified" &&
      stip.verification.structure_fingerprint === currentFingerprint
  );
  const rejectedStips = stips.filter((stip) => stip.verification?.status === "rejected");

  return {
    packet: {
      organizationId,
      deal,
      structure,
      overrideSnapshot,
      grouped,
      missingRequiredDocs,
      currentFingerprint,
      stips,
      checklist: {
        submitted: deal.submit_status === "submitted" || !!deal.submitted_at,
        credit_bureau: !!grouped.credit_bureau,
        required_stips: missingRequiredDocs.length === 0,
        required_stips_verified: requiredStipsVerified,
        structure_unchanged: stips.every((stip) => !stip.verification || stip.is_current),
        funding_rejected: rejectedStips.length > 0 || deal.funding_status === "rejected",
      },
    },
  };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;
  const supabase = await supabaseServer();

  const auth = await supabase.auth.getUser();
  if (auth.error || !auth.data.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await loadFundingPacket(supabase, dealId);
  if ("errorResponse" in result) return result.errorResponse;

  return NextResponse.json({
    ok: true,
    deal: result.packet.deal,
    selection: result.packet.structure
      ? {
          ...result.packet.structure,
          pti: getSnapshotPti(result.packet.structure.snapshot_json),
        }
      : null,
    overrides: result.packet.overrideSnapshot,
    documents: result.packet.grouped,
    stips: result.packet.stips,
    current_structure_fingerprint: result.packet.currentFingerprint,
    checklist: result.packet.checklist,
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;
  const supabase = await supabaseServer();
  const auth = await supabase.auth.getUser();
  const authContext = await getAuthContext(supabase);

  if (auth.error || !auth.data.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await hasDealershipPermission(authContext, "fund_deals"))) {
    return NextResponse.json({ error: "Funding review is restricted to managers and admins." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");
  const result = await loadFundingPacket(supabase, dealId);
  if ("errorResponse" in result) return result.errorResponse;

  const { packet } = result;
  if (!packet.currentFingerprint) {
    return NextResponse.json({ error: "Deal structure is missing." }, { status: 400 });
  }

  if (action === "verify_stip" || action === "reject_stip") {
    const docType = String(body.doc_type ?? "");
    if (!isRequiredDocType(docType)) {
      return NextResponse.json({ error: "Invalid stip type." }, { status: 400 });
    }

    const stip = packet.stips.find((item) => item.doc_type === docType);
    if (!stip?.documents.length) {
      return NextResponse.json({ error: "Cannot review a stip with no uploaded document." }, { status: 400 });
    }

    const rejectionReason = String(body.rejection_reason ?? "").trim();
    if (action === "reject_stip" && !rejectionReason) {
      return NextResponse.json({ error: "A rejection reason is required." }, { status: 400 });
    }
    const verifiedMonthlyIncome =
      action === "reject_stip" && docType === "proof_of_income"
        ? num(body.verified_monthly_income)
        : null;

    if (action === "reject_stip" && docType === "proof_of_income" && !verifiedMonthlyIncome) {
      return NextResponse.json(
        { error: "Verified monthly income is required when proof of income does not verify." },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const now = new Date().toISOString();
    const { data, error } = await admin
      .from("deal_funding_stip_verifications")
      .upsert(
        {
          organization_id: packet.organizationId,
          deal_id: dealId,
          doc_type: docType,
          status: action === "verify_stip" ? "verified" : "rejected",
          rejection_reason: action === "verify_stip" ? null : rejectionReason,
          verified_monthly_income: action === "verify_stip" ? null : verifiedMonthlyIncome,
          structure_fingerprint: packet.currentFingerprint,
          verified_by: auth.data.user.id,
          verified_at: now,
          updated_at: now,
        },
        { onConflict: "organization_id,deal_id,doc_type" }
      )
      .select("id, doc_type, status, rejection_reason, verified_monthly_income, structure_fingerprint, verified_by, verified_at")
      .single();

    if (error) {
      return NextResponse.json(
        { error: "Failed to save funding verification", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, verification: data });
  }

  if (action === "reject_funding") {
    const reason = String(body.reason ?? "").trim();
    if (!reason) {
      return NextResponse.json({ error: "A funding rejection reason is required." }, { status: 400 });
    }

    const now = new Date().toISOString();
    const { error } = await supabase
      .from("deals")
      .update({
        funding_status: "rejected",
        funding_decision_notes: reason,
        updated_at: now,
      })
      .eq("organization_id", packet.organizationId)
      .eq("id", dealId);

    if (error) {
      return NextResponse.json(
        { error: "Failed to reject funding", details: error.message },
        { status: 500 }
      );
    }

    await notifyFundingOutcome({
      organizationId: packet.organizationId,
      dealId,
      dealNumber: packet.deal.approval_number,
      customerName: packet.deal.customer_name,
      salespersonUserId: packet.deal.user_id,
      submittedByUserId: packet.deal.submitted_by,
      outcome: "rejected",
      reason,
    });

    return NextResponse.json({ ok: true, funding_status: "rejected" });
  }

  if (action === "fund") {
    if (!packet.checklist.required_stips_verified) {
      return NextResponse.json(
        { error: "All required stips must be verified against the current structure before funding." },
        { status: 400 }
      );
    }

    if (packet.checklist.funding_rejected) {
      return NextResponse.json(
        { error: "Funding is rejected. Resolve or re-verify rejected stips before funding." },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const { error } = await supabase
      .from("deals")
      .update({
        funded_at: now,
        funded_by: auth.data.user.id,
        funding_status: "funded",
        funding_decision_notes: "Funded after stip verification.",
        updated_at: now,
      })
      .eq("organization_id", packet.organizationId)
      .eq("id", dealId);

    if (error) {
      return NextResponse.json(
        { error: "Failed to fund deal", details: error.message },
        { status: 500 }
      );
    }

    await notifyFundingOutcome({
      organizationId: packet.organizationId,
      dealId,
      dealNumber: packet.deal.approval_number,
      customerName: packet.deal.customer_name,
      salespersonUserId: packet.deal.user_id,
      submittedByUserId: packet.deal.submitted_by,
      outcome: "funded",
    });

    return NextResponse.json({ ok: true, funding_status: "funded", funded_at: now });
  }

  if (action === "fund_with_income_change") {
    const incomeStip = packet.stips.find((stip) => stip.doc_type === "proof_of_income");
    const verifiedMonthlyIncome = incomeStip?.verification?.verified_monthly_income ?? null;

    if (incomeStip?.verification?.status !== "rejected" || !verifiedMonthlyIncome) {
      return NextResponse.json(
        { error: "Proof of income must be marked not verified with actual monthly income before funding with changes." },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const reason = `Funded with verified monthly income ${money(verifiedMonthlyIncome)}.`;
    const { error } = await supabase
      .from("deals")
      .update({
        funded_at: now,
        funded_by: auth.data.user.id,
        funding_status: "funded_with_changes",
        funding_decision_notes: reason,
        updated_at: now,
      })
      .eq("organization_id", packet.organizationId)
      .eq("id", dealId);

    if (error) {
      return NextResponse.json(
        { error: "Failed to fund deal with changes", details: error.message },
        { status: 500 }
      );
    }

    await notifyFundingOutcome({
      organizationId: packet.organizationId,
      dealId,
      dealNumber: packet.deal.approval_number,
      customerName: packet.deal.customer_name,
      salespersonUserId: packet.deal.user_id,
      submittedByUserId: packet.deal.submitted_by,
      outcome: "funded_with_changes",
      reason,
      verifiedMonthlyIncome,
    });

    return NextResponse.json({
      ok: true,
      funding_status: "funded_with_changes",
      funded_at: now,
    });
  }

  if (action === "send_back_to_underwriter") {
    const incomeStip = packet.stips.find((stip) => stip.doc_type === "proof_of_income");
    const verifiedMonthlyIncome = incomeStip?.verification?.verified_monthly_income ?? null;
    const reason =
      String(body.reason ?? "").trim() ||
      (verifiedMonthlyIncome
        ? `Proof of income verified at ${money(verifiedMonthlyIncome)} monthly. Restructure required.`
        : "Funding requested underwriting restructure.");
    const now = new Date().toISOString();

    const { error } = await supabase
      .from("deals")
      .update({
        funding_status: "restructure_requested",
        funding_decision_notes: reason,
        current_step: 4,
        workflow_status: "vehicle_selected",
        updated_at: now,
      })
      .eq("organization_id", packet.organizationId)
      .eq("id", dealId);

    if (error) {
      return NextResponse.json(
        { error: "Failed to send deal back to underwriting", details: error.message },
        { status: 500 }
      );
    }

    await notifyFundingOutcome({
      organizationId: packet.organizationId,
      dealId,
      dealNumber: packet.deal.approval_number,
      customerName: packet.deal.customer_name,
      salespersonUserId: packet.deal.user_id,
      submittedByUserId: packet.deal.submitted_by,
      outcome: "restructure_requested",
      reason,
      verifiedMonthlyIncome,
    });

    return NextResponse.json({
      ok: true,
      funding_status: "restructure_requested",
    });
  }

  return NextResponse.json({ error: "Invalid funding action." }, { status: 400 });
}
