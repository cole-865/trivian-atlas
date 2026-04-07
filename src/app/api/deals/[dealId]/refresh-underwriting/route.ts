import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import {
    assertDealInCurrentOrganization,
    NO_CURRENT_ORGANIZATION_MESSAGE,
} from "@/lib/deals/organizationScope";
import { scopeQueryToOrganization } from "@/lib/deals/childOrganizationScope";

function round2(n: number) {
    return Number((n || 0).toFixed(2));
}

type Tier = "A" | "B" | "C" | "D" | "BHPH";

const TIER_ORDER: Tier[] = ["BHPH", "D", "C", "B", "A"];

function clampTierIndex(idx: number): number {
    return Math.max(0, Math.min(TIER_ORDER.length - 1, idx));
}

function moveTier(start: Tier, delta: number): Tier {
    const startIdx = TIER_ORDER.indexOf(start);
    return TIER_ORDER[clampTierIndex(startIdx + delta)];
}

function roundHalfStep(value: number): number {
    return Math.round(value * 2) / 2;
}

export async function POST(
    _req: Request,
    { params }: { params: Promise<{ dealId: string }> }
) {
    const { dealId } = await params;
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

    const { data: bureauSummary, error: bureauErr } = await supabase
        .from("bureau_summary")
        .select(
            "score, repo_count, months_since_repo, paid_auto_trades, open_auto_trades"
        )
        .eq("deal_id", dealId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (bureauErr) {
        return NextResponse.json(
            { error: "Failed to load bureau summary", details: bureauErr.message },
            { status: 500 }
        );
    }

    if (!bureauSummary) {
        return NextResponse.json(
            { error: "No bureau summary found for deal" },
            { status: 400 }
        );
    }

    const { data: primaryPerson, error: personErr } = await scopeQueryToOrganization(
        supabase.from("deal_people").select("id, residence_months"),
        scopedDeal.organizationId
    )
        .eq("deal_id", dealId)
        .eq("role", "primary")
        .maybeSingle();

    if (personErr) {
        return NextResponse.json(
            { error: "Failed to load primary applicant", details: personErr.message },
            { status: 500 }
        );
    }

    if (!primaryPerson) {
        return NextResponse.json(
            { error: "No primary applicant found for deal" },
            { status: 400 }
        );
    }

    const score = bureauSummary.score != null ? Number(bureauSummary.score) : null;
    const repoCount = Number(bureauSummary.repo_count ?? 0);
    const monthsSinceRepo =
        bureauSummary.months_since_repo != null
            ? Number(bureauSummary.months_since_repo)
            : null;
    const paidAutoTrades = Number(bureauSummary.paid_auto_trades ?? 0);
    const openAutoTrades = Number(bureauSummary.open_auto_trades ?? 0);
    const residenceMonths =
        primaryPerson.residence_months != null
            ? Number(primaryPerson.residence_months)
            : null;

    if ((score ?? 999) < 420) {
        const payload = {
            deal_id: dealId,
            stage: "bureau_precheck",
            score_total: 0,
            decision: "denied",
            notes: "Hard stop: bureau score below minimum threshold.",
            tier: null,
            max_term_months: null,
            min_cash_down: null,
            min_down_pct: null,
            max_pti: null,
            max_amount_financed: null,
            max_vehicle_price: null,
            max_ltv: null,
            apr: null,
            hard_stop: true,
            hard_stop_reason: "Score below 420",
            score_factors: [],
            updated_at: new Date().toISOString(),
        };

        const { error: upsertErr } = await supabase
            .from("underwriting_results")
            .upsert(payload, { onConflict: "deal_id,stage" });

        if (upsertErr) {
            return NextResponse.json(
                { error: "Failed to save underwriting results", details: upsertErr.message },
                { status: 500 }
            );
        }

        return NextResponse.json({ ok: true, refreshed: true, deal_id: dealId, result: payload });
    }

    if (repoCount > 1 && monthsSinceRepo !== null && monthsSinceRepo < 12) {
        const payload = {
            deal_id: dealId,
            stage: "bureau_precheck",
            score_total: 0,
            decision: "denied",
            notes: "Hard stop: excessive recent repos.",
            tier: null,
            max_term_months: null,
            min_cash_down: null,
            min_down_pct: null,
            max_pti: null,
            max_amount_financed: null,
            max_vehicle_price: null,
            max_ltv: null,
            apr: null,
            hard_stop: true,
            hard_stop_reason: "More than 1 repo within last 12 months",
            score_factors: [],
            updated_at: new Date().toISOString(),
        };

        const { error: upsertErr } = await supabase
            .from("underwriting_results")
            .upsert(payload, { onConflict: "deal_id,stage" });

        if (upsertErr) {
            return NextResponse.json(
                { error: "Failed to save underwriting results", details: upsertErr.message },
                { status: 500 }
            );
        }

        return NextResponse.json({ ok: true, refreshed: true, deal_id: dealId, result: payload });
    }

    let movement = 0;
    const scoreFactors: Array<{ code: string; points: number; note: string }> = [];

    if (paidAutoTrades >= 2) {
        movement += 1.5;
        scoreFactors.push({ code: "PAID_AUTOS_2_PLUS", points: 1.5, note: "2+ paid auto trades" });
    } else if (paidAutoTrades === 1) {
        movement += 1;
        scoreFactors.push({ code: "PAID_AUTOS_1", points: 1, note: "1 paid auto trade" });
    }

    if (openAutoTrades === 0 && paidAutoTrades === 0) {
        movement -= 1;
        scoreFactors.push({ code: "NO_AUTO_HISTORY", points: -1, note: "No auto history" });
    } else if (openAutoTrades > 0) {
        scoreFactors.push({ code: "OPEN_AUTO_PRESENT", points: 0, note: "Open auto present; neutral in v1" });
    }

    if ((residenceMonths ?? 0) > 24) {
        movement += 1;
        scoreFactors.push({ code: "RES_OVER_24", points: 1, note: "Residence over 24 months" });
    } else if ((residenceMonths ?? 0) >= 12) {
        movement += 0.5;
        scoreFactors.push({ code: "RES_12_24", points: 0.5, note: "Residence 12-24 months" });
    } else if ((residenceMonths ?? 0) < 6) {
        movement -= 1;
        scoreFactors.push({ code: "RES_UNDER_6", points: -1, note: "Residence under 6 months" });
    }

    const cappedMovement = Math.max(-2, Math.min(2, roundHalfStep(movement)));
    const tier = moveTier("C", Math.trunc(cappedMovement));

    const { data: policy, error: policyErr } = await supabase
        .from("underwriting_tier_policy")
        .select(
            "tier, max_vehicle_price, max_amount_financed, max_ltv, max_term_months, max_pti, min_cash_down, min_down_pct, apr"
        )
        .eq("tier", tier)
        .eq("active", true)
        .order("sort_order", { ascending: true })
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (policyErr) {
        return NextResponse.json(
            { error: "Failed to load underwriting tier policy", details: policyErr.message },
            { status: 500 }
        );
    }

    if (!policy) {
        return NextResponse.json(
            { error: `No active underwriting tier policy found for tier ${tier}` },
            { status: 500 }
        );
    }

    const payload = {
        deal_id: dealId,
        stage: "bureau_precheck",
        score_total: cappedMovement,
        decision: "approved",
        notes: `Started at Tier C. Raw movement: ${movement}. Capped movement: ${cappedMovement}. Final tier: ${tier}.`,
        tier,
        max_term_months: Number(policy.max_term_months ?? 0),
        min_cash_down: round2(Number(policy.min_cash_down ?? 0)),
        min_down_pct: Number(policy.min_down_pct ?? 0),
        max_pti: Number(policy.max_pti ?? 0),
        max_amount_financed: round2(Number(policy.max_amount_financed ?? 0)),
        max_vehicle_price: round2(Number(policy.max_vehicle_price ?? 0)),
        max_ltv: Number(policy.max_ltv ?? 0),
        apr: Number(policy.apr ?? 28.99),
        hard_stop: false,
        hard_stop_reason: null,
        score_factors: scoreFactors,
        updated_at: new Date().toISOString(),
    };

    const { error: upsertErr } = await supabase
        .from("underwriting_results")
        .upsert(payload, { onConflict: "deal_id,stage" });

    if (upsertErr) {
        return NextResponse.json(
            { error: "Failed to save underwriting results", details: upsertErr.message },
            { status: 500 }
        );
    }

    return NextResponse.json({
        ok: true,
        refreshed: true,
        deal_id: dealId,
        result: payload,
    });
}
