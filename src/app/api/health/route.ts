import { NextResponse } from "next/server";
import {
  getHealthResponseInit,
  getHealthResponsePayload,
} from "@/lib/health/response";

function checkApplicationHealth() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export function GET() {
  const isHealthy = checkApplicationHealth();

  return NextResponse.json(
    getHealthResponsePayload(isHealthy),
    getHealthResponseInit(isHealthy)
  );
}

export function HEAD() {
  const isHealthy = checkApplicationHealth();
  return new Response(null, getHealthResponseInit(isHealthy));
}
