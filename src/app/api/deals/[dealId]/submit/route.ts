import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { canAccessStep } from "@/lib/deals/canAccessStep";
import {
    getDealForCurrentOrganization,
    NO_CURRENT_ORGANIZATION_MESSAGE,
} from "@/lib/deals/organizationScope";
import { scopeQueryToOrganization } from "@/lib/deals/childOrganizationScope";
import { loadInventoryVehicleForOrganization } from "@/lib/los/organizationScope";
import { buildOverrideStructureSnapshot } from "@/lib/deals/dealOverrideWorkflow";
import { loadDealOverrideSnapshot } from "@/lib/deals/dealOverrideServer";
import { sendDealApprovalRequestEmail } from "@/lib/email/notifications";
import { createDealFundingReviewNotifications } from "@/lib/notifications/appNotifications";
import { getSubmitRequirementSettings } from "@/lib/deals/workflowAccess";

const REQUIRED_DOC_TYPES = [
    "proof_of_income",
    "proof_of_residence",
    "driver_license",
] as const;

type InventoryStatusRow = {
    id: string;
    status: string | null;
};

function num(value: unknown): number | null {
    if (value == null || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function getSnapshotPti(snapshot: unknown) {
    if (!snapshot || typeof snapshot !== "object") return null;
    const structure = (snapshot as { structure?: { pti?: unknown } }).structure;
    return num(structure?.pti);
}

export async function POST(
    req: Request,
    { params }: { params: Promise<{ dealId: string }> }
) {
    const { dealId } = await params;
    const supabase = await supabaseServer();

    const {
        data: { user },
        error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const fundingNotes = String(body.funding_notes ?? "").trim();
    const internalNotes = String(body.internal_notes ?? "").trim();

    // Load deal
    const { data: deal, error: dealErr, organizationId } =
        await getDealForCurrentOrganization<{
            id: string;
            customer_name: string | null;
            workflow_status: string | null;
            current_step: number | null;
        }>(supabase, dealId, "id, customer_name, workflow_status, current_step");

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

    // Load saved structure (this is the real source of truth, not vehicle_selection)
    const { data: dealStructure, error: structureErr } = await scopeQueryToOrganization(
        supabase
            .from("deal_structure")
            .select(`
      deal_id,
      vehicle_id,
      option_label,
      include_vsc,
      include_gap,
      cash_down,
      term_months,
      monthly_payment,
      amount_financed,
      apr,
      fits_program,
      ltv,
      fail_reasons,
      snapshot_json
    `),
        organizationId
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
            status: deal.workflow_status,
            selected_vehicle_id: dealStructure?.vehicle_id ?? null,
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

    // Verify selected vehicle still exists in inventory
    let inventoryRow: { id: string; status: string | null } | null = null;

    if (dealStructure?.vehicle_id) {
        const { data: inv, error: inventoryErr } = await loadInventoryVehicleForOrganization<InventoryStatusRow>(
            supabase,
            organizationId,
            dealStructure.vehicle_id,
            "id, status"
        );

        if (inventoryErr) {
            return NextResponse.json(
                { error: "Failed to verify inventory", details: inventoryErr.message },
                { status: 500 }
            );
        }

        inventoryRow = inv;
    }

    // Credit bureau present?
    const { data: bureauDocs, error: bureauErr } = await scopeQueryToOrganization(
        supabase.from("deal_documents").select("id, doc_type"),
        organizationId
    )
        .eq("deal_id", dealId)
        .eq("doc_type", "credit_bureau");

    if (bureauErr) {
        return NextResponse.json(
            { error: "Failed to load bureau docs", details: bureauErr.message },
            { status: 500 }
        );
    }

    // All docs for stip validation
    const { data: docs, error: docsErr } = await scopeQueryToOrganization(
        supabase.from("deal_documents").select("id, doc_type"),
        organizationId
    )
        .eq("deal_id", dealId);

    if (docsErr) {
        return NextResponse.json(
            { error: "Failed to load deal documents", details: docsErr.message },
            { status: 500 }
        );
    }

    const uploadedTypes = new Set((docs ?? []).map((d) => d.doc_type));
    const missingRequiredDocs = REQUIRED_DOC_TYPES.filter((t) => !uploadedTypes.has(t));

    const blockers: string[] = [];
    const overrideSnapshot = dealStructure
        ? await loadDealOverrideSnapshot({
            organizationId,
            dealId,
            customerName: deal.customer_name,
            failReasons: dealStructure.fail_reasons ?? [],
            liveStructure: buildOverrideStructureSnapshot({
                vehicleId: dealStructure.vehicle_id,
                cashDown: dealStructure.cash_down,
                amountFinanced: dealStructure.amount_financed,
                monthlyPayment: dealStructure.monthly_payment,
                termMonths: dealStructure.term_months,
                ltv: dealStructure.ltv ?? null,
                pti: getSnapshotPti(dealStructure.snapshot_json),
            }),
        })
        : null;

    if (!dealStructure) {
        blockers.push("Deal structure missing");
    } else if (!dealStructure.vehicle_id) {
        blockers.push("Vehicle selection missing");
    }

    if (dealStructure?.vehicle_id && !inventoryRow?.id) {
        blockers.push("Selected vehicle is no longer in inventory");
    }

    const submitRequirements = await getSubmitRequirementSettings(supabase);

    if (
        submitRequirements.requireCreditBureauBeforeSubmit &&
        (!bureauDocs || bureauDocs.length === 0)
    ) {
        blockers.push("Credit bureau missing");
    }

    if (missingRequiredDocs.length > 0) {
        blockers.push(`Missing required docs: ${missingRequiredDocs.join(", ")}`);
    }

    if (overrideSnapshot?.effectiveBlockers.length) {
        blockers.push(
            `Program blockers unresolved: ${overrideSnapshot.effectiveBlockers.join(", ")}`
        );
    }

    if (blockers.length > 0) {
        return NextResponse.json(
            {
                error: "Deal is not ready for submit",
                blockers,
            },
            { status: 400 }
        );
    }

    const now = new Date().toISOString();

    const { error: updateErr } = await supabase
        .from("deals")
        .update({
            funding_notes: fundingNotes,
            internal_notes: internalNotes,
            submitted_at: now,
            submitted_by: user.id,
            submit_status: "submitted",
            workflow_status: "submitted_complete",
            current_step: 6,
            updated_at: now,
        })
        .eq("id", dealId)
        .eq("organization_id", organizationId);

    if (updateErr) {
        return NextResponse.json(
            { error: "Failed to submit deal", details: updateErr.message },
            { status: 500 }
        );
    }

    try {
        await createDealFundingReviewNotifications({
            organizationId,
            dealId,
            customerName: deal.customer_name,
        });
    } catch (error) {
        console.error("deal funding review notification failed:", error);
    }

    try {
        const emailResult = await sendDealApprovalRequestEmail({
            organizationId,
            dealId,
            customerName: deal.customer_name,
            submittedByUserId: user.id,
        });

        if (!emailResult.sent && emailResult.reason) {
            console.warn("deal approval email not sent:", emailResult.reason);
        }
    } catch (error) {
        console.error("deal approval email failed:", error);
    }

    return NextResponse.json({
        ok: true,
        deal_id: dealId,
        submitted_at: now,
        submitted_by: user.id,
        submit_status: "submitted",
        next_step: 6,
    });
}
