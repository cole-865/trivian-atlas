import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getAuthContext } from "@/lib/auth/userRole";
import { isAsk865PlatformDev } from "@/lib/ask865/accessRules";
import { getAsk865Module } from "@/lib/ask865/access";
import { PageHeader, SectionCard, NoticeBanner } from "@/components/atlas/page";
import { Button } from "@/components/ui/button";
import { setAsk865Enabled } from "./actions";

export default async function ModulesPage({searchParams}:{searchParams:Promise<{saved?:string}>}) {
 const context=await getAuthContext(await createClient());
 if(!isAsk865PlatformDev(context)) redirect("/home");
 const entitlement=context.currentOrganizationId ? await getAsk865Module(context.currentOrganizationId) : null;
 const {saved}=await searchParams;
 return <div className="grid gap-4"><PageHeader eyebrow="Platform" title="Account modules" description={`Optional modules for ${context.currentOrganization?.name ?? "the selected account"}.`} />
 {saved==="1" && <NoticeBanner tone="notice">Module setting saved.</NoticeBanner>}
 <SectionCard title="Ask 865" description="Sales, inventory, finance, service history and source health. User access is managed through the existing account permissions.">
 {entitlement ? <form action={setAsk865Enabled} className="flex flex-wrap items-center gap-4">
 <input type="hidden" name="organization" value={context.currentOrganizationId!} />
 <label className="flex items-center gap-2"><input type="checkbox" name="enabled" defaultChecked={entitlement.enabled} />Enable Ask 865</label>
 <Button type="submit">Save module</Button></form> : <p className="text-sm text-muted-foreground">Connect this dealership’s own reporting source before enabling the module.</p>}
 </SectionCard></div>;
}
