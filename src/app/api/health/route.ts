import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import {
  getHealthResponseInit,
  getHealthResponsePayload,
} from "@/lib/health/response";

async function checkApplicationHealth() {
  try {
    const supabase = await supabaseServer();
    const { error } = await supabase
      .from("organizations")
      .select("id", { head: true })
      .limit(1);

    return !error;
  } catch {
    return false;
  }
}

export async function GET() {
  const isHealthy = await checkApplicationHealth();

  return NextResponse.json(
    getHealthResponsePayload(isHealthy),
    getHealthResponseInit(isHealthy)
  );
}

export async function HEAD() {
  const isHealthy = await checkApplicationHealth();
  return new Response(null, getHealthResponseInit(isHealthy));
}
