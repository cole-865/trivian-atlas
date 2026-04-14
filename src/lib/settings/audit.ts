import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.generated";

export async function logOrganizationSettingsChange(args: {
  organizationId: string;
  changedByUserId: string | null;
  changeType: string;
  entityType: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("audit_log").insert({
    organization_id: args.organizationId,
    changed_by_user_id: args.changedByUserId,
    actor_id: args.changedByUserId,
    action: args.changeType,
    change_type: args.changeType,
    entity_type: args.entityType,
    before: args.before as Json,
    after: args.after as Json,
    meta: (args.after ?? {}) as Json,
  });

  if (error) {
    throw new Error(`Failed to write settings audit log: ${error.message}`);
  }
}
