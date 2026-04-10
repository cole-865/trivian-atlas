import { NextResponse } from "next/server";
import { canAccessStep } from "@/lib/deals/canAccessStep";
import { loadDealStructurePageData } from "@/lib/deals/dealStructureLoader";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ dealId: string }> }
) {
    const { dealId } = await params;

    try {
        const data = await loadDealStructurePageData({ dealId });
        const supabase = await supabaseServer();
        const access = await canAccessStep({
            supabase,
            step: "deal",
            deal: {
                selected_vehicle_id: data.selection.vehicle_id,
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

        return NextResponse.json(data);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load deal structure";
        const status =
            message === "Deal not found"
                ? 404
                : message === "No vehicle selection found for this deal"
                  ? 404
                  : message.includes("organization")
                    ? 400
                    : 500;

        return NextResponse.json({ error: message }, { status });
    }
}
