import "server-only";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthContext, type AuthContext } from "@/lib/auth/userRole";
import { hasDealershipPermission } from "@/lib/auth/dealershipPermissions";
import { hasAsk865OrganizationIdentity } from "./accessRules";

export class Ask865AccessError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function getAsk865Module(organizationId: string) {
  const { data, error } = await createAdminClient().from("organization_modules")
    .select("enabled").eq("organization_id", organizationId).eq("module_key", "ask865").maybeSingle();
  if (error) throw new Error("Module configuration is unavailable");
  return data;
}

export async function getAsk865Access(context?: AuthContext) {
  const auth = context ?? await getAuthContext(await createClient());
  if (!auth.realUser) throw new Ask865AccessError(401, "Sign in to view Ask 865.");
  if (!hasAsk865OrganizationIdentity(auth) || !auth.currentOrganizationId) {
    throw new Ask865AccessError(403, "Ask 865 is unavailable for this account.");
  }
  if (!await hasDealershipPermission(auth, "view_ask865")) {
    throw new Ask865AccessError(403, "You do not have permission to view Ask 865.");
  }
  if (!(await getAsk865Module(auth.currentOrganizationId))?.enabled) {
    throw new Ask865AccessError(403, "Ask 865 is not enabled for this dealership.");
  }
  const [canExport, canReview] = await Promise.all([
    hasDealershipPermission(auth, "export_reports"),
    hasDealershipPermission(auth, "review_ask865_sources"),
  ]);
  return { organizationId: auth.currentOrganizationId,
    organizationName: auth.currentOrganization!.name, canExport, canReview,
    actor: auth.effectiveProfile!.email || auth.effectiveProfile!.id };
}

export async function canViewAsk865(context: AuthContext) {
  try { await getAsk865Access(context); return true; }
  catch { return false; } // A missing migration/config must not break Atlas navigation.
}
