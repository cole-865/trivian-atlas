import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../../src/lib/supabase/database.types.js";

const integrationEnabled = process.env.RUN_SUPABASE_INTEGRATION === "1";

export type IntegrationClient = ReturnType<typeof createIntegrationClient>;

function createIntegrationClient(url: string, serviceRoleKey: string) {
  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function requireIntegrationEnv() {
  if (!integrationEnabled) {
    return null;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  assert.ok(url, "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL");
  assert.ok(serviceRoleKey, "Missing SUPABASE_SERVICE_ROLE_KEY");

  return createIntegrationClient(url, serviceRoleKey);
}

export function integrationTest(
  name: string,
  fn: (client: IntegrationClient) => Promise<void>
) {
  return { name, fn, enabled: integrationEnabled };
}

export function makeIntegrationSlug(prefix: string) {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`.toLowerCase();
}

export function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
