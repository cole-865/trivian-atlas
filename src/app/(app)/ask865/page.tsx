import { redirect } from "next/navigation";
import { getAsk865Access, Ask865AccessError } from "@/lib/ask865/access";
import { DashboardApp } from "@/components/ask865/DashboardApp";
import { NoticeBanner, PageHeader } from "@/components/atlas/page";
import "./ask865.css";
export const dynamic="force-dynamic";

export default async function Ask865Page() {
  let access;
  try { access=await getAsk865Access(); }
  catch(error) {
    if(error instanceof Ask865AccessError && error.status===401) redirect("/login");
    return <div className="grid gap-4"><PageHeader eyebrow="Reporting" title="Ask 865" description="Dealership reporting inside Atlas." />
      <NoticeBanner tone="error">{error instanceof Ask865AccessError ? error.message : "Ask 865 is temporarily unavailable. Try again shortly."}</NoticeBanner></div>;
  }
  return <DashboardApp key={access.organizationId} organizationId={access.organizationId}
    organizationName={access.organizationName} canExport={access.canExport} canReview={access.canReview} />;
}
