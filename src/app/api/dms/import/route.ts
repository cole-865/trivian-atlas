import { hasDealershipPermission } from "@/lib/auth/dealershipPermissions";
import { getAuthContext } from "@/lib/auth/userRole";
import { handleDmsImportPost } from "@/lib/dms/importRouteHandler";
import { createAdminClient } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";

export async function POST(req: Request) {
  return handleDmsImportPost(req, {
    getSessionClient: supabaseServer,
    getAuthContext,
    hasDealershipPermission,
    createAdminClient,
  });
}
