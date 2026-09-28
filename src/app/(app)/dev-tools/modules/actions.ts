"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthContext } from "@/lib/auth/userRole";
import { isAsk865PlatformDev } from "@/lib/ask865/accessRules";

export async function setAsk865Enabled(form: FormData) {
  const context=await getAuthContext(await createClient());
  if(!isAsk865PlatformDev(context) || !context.currentOrganizationId || !context.currentOrganization?.isActive) throw new Error("Platform access required.");
  if(form.get("organization")!==context.currentOrganizationId) throw new Error("The selected account changed. Reload this page.");
  const {data,error}=await createAdminClient().from("organization_modules").update({
    enabled:form.get("enabled")==="on",updated_by:context.realUser!.id,updated_at:new Date().toISOString(),
  }).eq("organization_id",context.currentOrganizationId).eq("module_key","ask865").select("organization_id");
  if(error || data?.length!==1) throw new Error("This dealership's reporting source must be connected before enabling Ask 865.");
  revalidatePath("/","layout");
  redirect("/dev-tools/modules?saved=1");
}
