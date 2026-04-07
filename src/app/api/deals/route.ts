import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  getCurrentOrganizationIdForDeals,
  NO_CURRENT_ORGANIZATION_MESSAGE,
} from "@/lib/deals/organizationScope";

export async function POST(req: Request) {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationIdForDeals(supabase);

  const body = await req.json().catch(() => ({}));
  const customer_name = String(body.customer_name ?? "").trim();

  if (!customer_name) {
    return NextResponse.json(
      { error: "customer_name is required" },
      { status: 400 }
    );
  }

  if (!organizationId) {
    return NextResponse.json(
      { error: NO_CURRENT_ORGANIZATION_MESSAGE },
      { status: 400 }
    );
  }

  const { data, error } = await supabase.rpc("create_deal_with_seed_data", {
    p_customer_name: customer_name,
    p_organization_id: organizationId,
  });

  if (error || !data?.length) {
    return NextResponse.json(
      {
        error: "Failed to create deal",
        details: error?.message ?? "No data returned",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    deal: {
      id: data[0].deal_id,
      approval_number: data[0].approval_number,
    },
  });
}
