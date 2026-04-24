import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import {
    getDealForCurrentOrganization,
    NO_CURRENT_ORGANIZATION_MESSAGE,
} from "@/lib/deals/organizationScope";
import { scopeQueryToOrganization } from "@/lib/deals/childOrganizationScope";
import {
    scopeDealChildQueryToOrganization,
} from "@/lib/deals/underwritingOrganizationScope";
import { loadActiveUnderwritingTierPolicy } from "@/lib/los/organizationScope";
import { scoreDealTier, type TierApplicantInput } from "@/lib/underwriting/scoreDealTier";

function round2(n: number) {
    return Number((n || 0).toFixed(2));
}

function num(v: unknown): number {
    if (v === null || v === undefined || v === "") return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function pickMonthly(row: { monthly_gross_calculated: unknown; monthly_gross_manual: unknown }) {
    const calculated = num(row.monthly_gross_calculated);
    const manual = num(row.monthly_gross_manual);
    return calculated > 0 ? calculated : manual > 0 ? manual : 0;
}

type BureauSummaryRow = {
    score: number | null;
    repo_count: number | null;
    months_since_repo: number | null;
    paid_auto_trades: number | null;
    open_auto_trades: number | null;
    months_since_bankruptcy: number | null;
    total_collections: number | null;
    total_chargeoffs: number | null;
    past_due_amount: number | null;
    total_tradelines: number | null;
    open_tradelines: number | null;
    autos_on_bureau: number | null;
};

type DealPersonRow = {
    id: string;
    role: string;
    residence_months: number | null;
    address_line1: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
};

function toApplicantInput(
    summary: BureauSummaryRow | null,
    person: DealPersonRow | null
): TierApplicantInput | null {
    if (!summary) return null;

    return {
        score: summary.score != null ? Number(summary.score) : null,
        repoCount: Number(summary.repo_count ?? 0),
        monthsSinceRepo:
            summary.months_since_repo != null ? Number(summary.months_since_repo) : null,
        paidAutoTrades: Number(summary.paid_auto_trades ?? 0),
        openAutoTrades: Number(summary.open_auto_trades ?? 0),
        residenceMonths:
            person?.residence_months != null ? Number(person.residence_months) : null,
        monthsSinceBankruptcy:
            summary.months_since_bankruptcy != null
                ? Number(summary.months_since_bankruptcy)
                : null,
        totalCollections:
            summary.total_collections != null ? Number(summary.total_collections) : null,
        totalChargeoffs:
            summary.total_chargeoffs != null ? Number(summary.total_chargeoffs) : null,
        pastDueAmount:
            summary.past_due_amount != null ? Number(summary.past_due_amount) : null,
        totalTradelines:
            summary.total_tradelines != null ? Number(summary.total_tradelines) : null,
        openTradelines:
            summary.open_tradelines != null ? Number(summary.open_tradelines) : null,
        autosOnBureau:
            summary.autos_on_bureau != null ? Number(summary.autos_on_bureau) : null,
    };
}

export async function POST(
    _req: Request,
    { params }: { params: Promise<{ dealId: string }> }
) {
    const { dealId } = await params;
    const supabase = await supabaseServer();
    const scopedDeal = await getDealForCurrentOrganization<{
        id: string;
        household_income: boolean | null;
    }>(supabase, dealId, "id, household_income");

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

    const { data: primaryBureauSummary, error: primaryBureauErr } = await scopeDealChildQueryToOrganization(
        supabase
            .from("bureau_summary")
            .select("*"),
        scopedDeal.organizationId,
        dealId
    )
        .eq("applicant_role", "primary")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (primaryBureauErr) {
        return NextResponse.json(
            { error: "Failed to load primary bureau summary", details: primaryBureauErr.message },
            { status: 500 }
        );
    }

    if (!primaryBureauSummary) {
        const skipped = scoreDealTier({
            primary: null,
            coApplicantContext: {
                householdIncome: Boolean(scopedDeal.data.household_income),
                hasAppliedIncome: false,
                primaryAddress: null,
                coApplicantAddress: null,
            },
        });

        return NextResponse.json(
            {
                error: "No primary bureau summary found for deal",
                result: skipped,
            },
            { status: 400 }
        );
    }

    const { data: coBureauSummary, error: coBureauErr } = await scopeDealChildQueryToOrganization(
        supabase
            .from("bureau_summary")
            .select("*"),
        scopedDeal.organizationId,
        dealId
    )
        .eq("applicant_role", "co")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (coBureauErr) {
        return NextResponse.json(
            { error: "Failed to load co-app bureau summary", details: coBureauErr.message },
            { status: 500 }
        );
    }

    const { data: people, error: personErr } = await scopeQueryToOrganization(
        supabase
            .from("deal_people")
            .select("id, role, residence_months, address_line1, city, state, zip"),
        scopedDeal.organizationId
    )
        .eq("deal_id", dealId)
        .in("role", ["primary", "co"]);

    if (personErr) {
        return NextResponse.json(
            { error: "Failed to load applicants", details: personErr.message },
            { status: 500 }
        );
    }

    const personRows = (people ?? []) as DealPersonRow[];
    const primaryPerson = personRows.find((person) => person.role === "primary") ?? null;
    const coPerson = personRows.find((person) => person.role === "co") ?? null;

    if (!primaryPerson) {
        return NextResponse.json(
            { error: "No primary applicant found for deal" },
            { status: 400 }
        );
    }

    const coPersonId = coPerson?.id ?? null;
    const { data: coIncomeRows, error: coIncomeErr } = coPersonId
        ? await scopeQueryToOrganization(
            supabase
                .from("income_profiles")
                .select("id, applied_to_deal, monthly_gross_calculated, monthly_gross_manual"),
            scopedDeal.organizationId
        )
            .eq("deal_person_id", coPersonId)
            .eq("applied_to_deal", true)
        : { data: [], error: null };

    if (coIncomeErr) {
        return NextResponse.json(
            { error: "Failed to load co-app income", details: coIncomeErr.message },
            { status: 500 }
        );
    }

    const coHasAppliedIncome = (coIncomeRows ?? []).some((row) => pickMonthly(row) > 0);

    const scored = scoreDealTier({
        primary: toApplicantInput(primaryBureauSummary as BureauSummaryRow, primaryPerson),
        coApplicant: toApplicantInput((coBureauSummary ?? null) as BureauSummaryRow | null, coPerson),
        coApplicantContext: {
            householdIncome: Boolean(scopedDeal.data.household_income),
            hasAppliedIncome: coHasAppliedIncome,
            primaryAddress: {
                addressLine1: primaryPerson.address_line1,
                city: primaryPerson.city,
                state: primaryPerson.state,
                zip: primaryPerson.zip,
            },
            coApplicantAddress: coPerson
                ? {
                    addressLine1: coPerson.address_line1,
                    city: coPerson.city,
                    state: coPerson.state,
                    zip: coPerson.zip,
                }
                : null,
        },
    });

    if (scored.hardStop || !scored.tier) {
        const payload = {
            organization_id: scopedDeal.organizationId,
            deal_id: dealId,
            stage: "bureau_precheck",
            score_total: scored.scoreTotal,
            decision: scored.decision,
            notes: scored.notes,
            tier: null,
            max_term_months: null,
            min_cash_down: null,
            min_down_pct: null,
            max_pti: null,
            max_amount_financed: null,
            max_vehicle_price: null,
            max_ltv: null,
            apr: null,
            hard_stop: scored.hardStop,
            hard_stop_reason: scored.hardStopReason,
            score_factors: scored.scoreFactors,
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

    const { data: policy, error: policyErr } = await loadActiveUnderwritingTierPolicy(
        supabase,
        scopedDeal.organizationId,
        scored.tier
    );

    if (policyErr) {
        return NextResponse.json(
            { error: "Failed to load underwriting tier policy", details: policyErr.message },
            { status: 500 }
        );
    }

    if (!policy) {
        return NextResponse.json(
            { error: `No active underwriting tier policy found for tier ${scored.tier}` },
            { status: 500 }
        );
    }

    const payload = {
        organization_id: scopedDeal.organizationId,
        deal_id: dealId,
        stage: "bureau_precheck",
        score_total: scored.scoreTotal,
        decision: scored.decision,
        notes: scored.notes,
        tier: scored.tier,
        max_term_months: Number(policy.max_term_months ?? 0),
        min_cash_down: round2(Number(policy.min_cash_down ?? 0)),
        min_down_pct: Number(policy.min_down_pct ?? 0),
        max_pti: Number(policy.max_pti ?? 0),
        max_amount_financed: round2(Number(policy.max_amount_financed ?? 0)),
        max_vehicle_price: round2(Number(policy.max_vehicle_price ?? 0)),
        max_ltv: Number(policy.max_ltv ?? 0),
        apr: Number(policy.apr ?? 28.99),
        hard_stop: scored.hardStop,
        hard_stop_reason: scored.hardStopReason,
        score_factors: scored.scoreFactors,
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
