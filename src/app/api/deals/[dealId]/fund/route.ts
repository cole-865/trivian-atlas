import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { canAccessStep } from "@/lib/deals/canAccessStep";
import {
  getDealForCurrentOrganization,
  NO_CURRENT_ORGANIZATION_MESSAGE,
} from "@/lib/deals/organizationScope";

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

const REQUIRED_DOC_TYPES = [
  "proof_of_income",
  "proof_of_residence",
  "driver_license",
] as const;

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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;
  const supabase = await supabaseServer();

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: deal, error: dealErr, organizationId } =
    await getDealForCurrentOrganization<{
      id: string;
      workflow_status: string | null;
      submit_status: string | null;
      funding_notes: string | null;
      internal_notes: string | null;
      submitted_at: string | null;
      funded_at: string | null;
    }>(
      supabase,
      dealId,
      `
        id,
        workflow_status,
        submit_status,
        funding_notes,
        internal_notes,
        submitted_at,
        funded_at
      `
    );

  if (!organizationId) {
    return NextResponse.json(
      { error: NO_CURRENT_ORGANIZATION_MESSAGE },
      { status: 400 }
    );
  }

  if (dealErr) {
    return NextResponse.json(
      { error: "Failed to load deal", details: dealErr.message },
      { status: 500 }
    );
  }

  if (!deal?.id) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  const { data: underwritingResult, error: underwritingErr } = await supabase
    .from("underwriting_results")
    .select("decision")
    .eq("deal_id", dealId)
    .eq("stage", "bureau_precheck")
    .maybeSingle();

  if (underwritingErr) {
    return NextResponse.json(
      { error: "Failed to load underwriting result", details: underwritingErr.message },
      { status: 500 }
    );
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
    return NextResponse.json(
      { error: "Failed to load deal structure", details: structureErr.message },
      { status: 500 }
    );
  }

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
    return NextResponse.json(
      {
        ok: false,
        error: "STEP_BLOCKED",
        redirectTo: access.redirectTo ?? "submit",
        reason: access.reason,
      },
      { status: 403 }
    );
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
    return NextResponse.json(
      { error: "Failed to load documents", details: docsErr.message },
      { status: 500 }
    );
  }

  const grouped = emptyGroupedDocuments();

  for (const doc of (docs ?? []) as DealDocument[]) {
    if (doc.doc_type === "credit_bureau") {
      if (!grouped.credit_bureau) grouped.credit_bureau = doc;
      continue;
    }

    if (doc.doc_type === "proof_of_income") {
      grouped.proof_of_income.push(doc);
      continue;
    }

    if (doc.doc_type === "proof_of_residence") {
      grouped.proof_of_residence.push(doc);
      continue;
    }

    if (doc.doc_type === "driver_license") {
      grouped.driver_license.push(doc);
      continue;
    }

    if (doc.doc_type === "insurance") {
      grouped.insurance.push(doc);
      continue;
    }

    if (doc.doc_type === "references") {
      grouped.references.push(doc);
      continue;
    }

    grouped.other.push(doc);
  }

  const uploadedTypes = new Set((docs ?? []).map((d) => d.doc_type));
  const missingRequiredDocs = REQUIRED_DOC_TYPES.filter((t) => !uploadedTypes.has(t));

  const checklist = {
    submitted: deal.submit_status === "submitted" || !!deal.submitted_at,
    credit_bureau: !!grouped.credit_bureau,
    required_stips: missingRequiredDocs.length === 0,
  };

  return NextResponse.json({
    ok: true,
    deal,
    selection: structure ?? null,
    documents: grouped,
    checklist,
  });
}
