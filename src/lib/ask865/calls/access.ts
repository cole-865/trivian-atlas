import "server-only";
import { createClient } from "@/utils/supabase/server";
import { getAuthContext } from "@/lib/auth/userRole";
import { hasDealershipPermission } from "@/lib/auth/dealershipPermissions";
import { getAsk865Access, Ask865AccessError } from "../access";
import { hasCallPlaybackRole } from "../accessRules";

export async function getCallAccess(write = false) {
  const auth = await getAuthContext(await createClient());
  const access = await getAsk865Access(auth);
  if (!await hasDealershipPermission(auth, "review_ask865_calls")) {
    throw new Ask865AccessError(403, "You do not have permission to review calls.");
  }
  if (auth.isImpersonating) throw new Ask865AccessError(403, "Stop impersonating to access call reviews.");
  if (write && !auth.realUser?.id) throw new Ask865AccessError(401, "Sign in to review calls.");
  return { ...access, actorId: auth.realUser!.id, canPlayRecording: hasCallPlaybackRole(auth) };
}
