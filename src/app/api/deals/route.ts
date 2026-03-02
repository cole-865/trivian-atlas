import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { createDealSchema } from "@/lib/validation/deals";

// Generates YYMMDD-XXXXXX from created_at + id
function makeApprovalNumber(dealId: string, createdAt: string) {
  const yymmdd = createdAt.slice(2, 10).replaceAll("-", ""); // YYMMDD
  const short = dealId.replaceAll("-", "").slice(0, 6);
  return `${yymmdd}-${short}`;
}

export async function POST(req: Request) {
  const supabase = await supabaseServer();

  const body = await req.json().catch(() => ({}));
  const parsed = createDealSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // 1) Create deal
  const { data: deal, error: dealErr } = await supabase
    .from("deals")
    .insert({
      customer_name: parsed.data.customer_name ?? null,
      workflow_status: "draft",
      current_step: 1,
    })
    .select("id, created_at, approval_number, workflow_status, current_step")
    .single();

  if (dealErr || !deal) {
    return NextResponse.json(
      { error: "Failed to create deal", details: dealErr?.message },
      { status: 500 }
    );
  }

  // 2) Ensure approval_number exists
  let approvalNumber = deal.approval_number as string | null;
  if (!approvalNumber) {
    approvalNumber = makeApprovalNumber(deal.id, deal.created_at);
    const { error: updErr } = await supabase
      .from("deals")
      .update({ approval_number: approvalNumber })
      .eq("id", deal.id);

    if (updErr) {
      // Not fatal, but good to surface
      console.warn("approval_number update failed:", updErr.message);
    }
  }

  // 3) Seed Driver + Co-Signer
  const { data: people, error: peopleErr } = await supabase
    .from("deal_people")
    .insert([
      { deal_id: deal.id, role: "primary" },
      { deal_id: deal.id, role: "co" },
    ])
    .select("id, role");

  if (peopleErr || !people?.length) {
    return NextResponse.json(
      { error: "Failed to create deal people", details: peopleErr?.message },
      { status: 500 }
    );
  }

  // 4) Seed income profiles for each person
  const incomeRows = people.map((p) => ({
    deal_person_id: p.id,
    income_type: "w2",
  }));

  const { error: incomeErr } = await supabase
    .from("income_profiles")
    .insert(incomeRows);

  if (incomeErr) {
    return NextResponse.json(
      { error: "Failed to create income profiles", details: incomeErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    deal: {
      ...deal,
      approval_number: approvalNumber,
    },
    people,
  });
}

export async function GET() {
  const supabase = await supabaseServer();

  // Pull latest 50 deals
  const { data: deals, error: dealsErr } = await supabase
    .from("deals")
    .select("id, created_at, approval_number, workflow_status, current_step, customer_name")
    .order("created_at", { ascending: false })
    .limit(50);

  if (dealsErr) {
    return NextResponse.json(
      { error: "Failed to fetch deals", details: dealsErr.message },
      { status: 500 }
    );
  }

  const dealIds = (deals ?? []).map((d) => d.id);
  if (dealIds.length === 0) return NextResponse.json([]);

  // Join primary person for name/phone (Approvals list)
  const { data: primaries, error: peopleErr } = await supabase
    .from("deal_people")
    .select("deal_id, first_name, last_name, phone")
    .eq("role", "primary")
    .in("deal_id", dealIds);

  if (peopleErr) {
    return NextResponse.json(
      { error: "Failed to fetch primary people", details: peopleErr.message },
      { status: 500 }
    );
  }

  const primaryByDeal = new Map(
    (primaries ?? []).map((p) => [
      p.deal_id,
      {
        primary_name:
          [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || null,
        primary_phone: p.phone ?? null,
      },
    ])
  );

  const out = (deals ?? []).map((d) => ({
    ...d,
    ...(primaryByDeal.get(d.id) ?? { primary_name: null, primary_phone: null }),
  }));

  return NextResponse.json(out);
}