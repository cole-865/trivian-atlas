import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const customer_name = String(body?.customer_name ?? "").trim();

  // ✅ Server-side guardrail (cannot be bypassed)
  if (!customer_name) {
    return NextResponse.json(
      { error: "Customer name is required." },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  // If you want, add other fields here too later (phone, email, address, etc.)
  const { error } = await supabase
    .from("deals")
    .update({ customer_name })
    .eq("id", dealId);

  if (error) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}