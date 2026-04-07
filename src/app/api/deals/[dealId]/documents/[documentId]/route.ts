import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { canAccessStep } from "@/lib/deals/canAccessStep";
import {
  assertDealInCurrentOrganization,
  getDealForCurrentOrganization,
  NO_CURRENT_ORGANIZATION_MESSAGE,
} from "@/lib/deals/organizationScope";
import { scopeQueryToOrganization } from "@/lib/deals/childOrganizationScope";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ dealId: string; documentId: string }> }
) {
  const { dealId, documentId } = await params;
  const supabase = await supabaseServer();
  const scopedDeal = await assertDealInCurrentOrganization(supabase, dealId);

  if (!scopedDeal.organizationId) {
    return NextResponse.json(
      { error: NO_CURRENT_ORGANIZATION_MESSAGE },
      { status: 400 }
    );
  }

  if (scopedDeal.error) {
    return NextResponse.json(
      { error: "Failed to load deal", details: scopedDeal.error.message },
      { status: 500 }
    );
  }

  if (!scopedDeal.data) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  // load doc row (include doc_type)
  const { data: doc, error: loadErr } = await scopeQueryToOrganization(
    supabase
      .from("deal_documents")
      .select("id, deal_id, doc_type, storage_bucket, storage_path"),
    scopedDeal.organizationId
  )
    .eq("id", documentId)
    .eq("deal_id", dealId)
    .maybeSingle();

  if (loadErr) {
    return NextResponse.json(
      { error: "Failed to load document", details: loadErr.message },
      { status: 500 }
    );
  }

  if (!doc?.id) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  if (doc.doc_type !== "credit_bureau") {
    const { data: deal, error: dealErr } = await getDealForCurrentOrganization<{
      submit_status: string | null;
      submitted_at: string | null;
    }>(supabase, dealId, "submit_status, submitted_at");

    if (dealErr) {
      return NextResponse.json(
        { error: "Failed to load deal", details: dealErr.message },
        { status: 500 }
      );
    }

    const { data: structure, error: structureErr } = await scopeQueryToOrganization(
      supabase.from("deal_structure").select("vehicle_id"),
      scopedDeal.organizationId
    )
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
      step: "submit",
      deal: {
        selected_vehicle_id: structure?.vehicle_id ?? null,
        submit_status: deal?.submit_status ?? null,
        submitted_at: deal?.submitted_at ?? null,
      },
    });

    if (!access.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: "STEP_BLOCKED",
          redirectTo: access.redirectTo ?? "vehicle",
          reason: access.reason,
        },
        { status: 403 }
      );
    }
  }

  // If deleting a bureau doc, also delete the long-term record + jobs (+ redacted file if present)
  if (doc.doc_type === "credit_bureau") {
    // remove redacted pdf if your worker created one
    const { data: reportRow } = await supabase
      .from("credit_reports")
      .select("redacted_bucket, redacted_path")
      .eq("deal_id", dealId)
      .maybeSingle();

    if (reportRow?.redacted_bucket && reportRow?.redacted_path) {
      await supabase.storage
        .from(reportRow.redacted_bucket)
        .remove([reportRow.redacted_path]);
    }

    await supabase.from("credit_reports").delete().eq("deal_id", dealId);
    await supabase.from("credit_report_jobs").delete().eq("deal_id", dealId);
  }

  // remove from storage (raw or app doc)
  const { error: rmErr } = await supabase.storage
    .from(doc.storage_bucket)
    .remove([doc.storage_path]);

  if (rmErr) {
    return NextResponse.json(
      { error: "Failed to delete storage object", details: rmErr.message },
      { status: 500 }
    );
  }

  // delete row
  const { error: delErr } = await supabase
    .from("deal_documents")
    .delete()
    .eq("organization_id", scopedDeal.organizationId)
    .eq("id", documentId)
    .eq("deal_id", dealId);

  if (delErr) {
    return NextResponse.json(
      { error: "Failed to delete document record", details: delErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
