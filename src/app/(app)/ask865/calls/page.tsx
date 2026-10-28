import { redirect } from "next/navigation";
import { Ask865AccessError } from "@/lib/ask865/access";
import { getCallAccess } from "@/lib/ask865/calls/access";
import { CallInbox } from "@/components/ask865/CallInbox";
import { NoticeBanner, PageHeader } from "@/components/atlas/page";

export const dynamic = "force-dynamic";
export default async function CallsPage() {
  let access;
  try {
    access = await getCallAccess();
  } catch (error) {
    if (error instanceof Ask865AccessError && error.status === 401) redirect("/login");
    return <div className="grid gap-4"><PageHeader title="Call Intelligence" /><NoticeBanner tone="error">{error instanceof Ask865AccessError ? error.message : "Call Intelligence is temporarily unavailable."}</NoticeBanner></div>;
  }
  return <CallInbox key={access.organizationId} organizationId={access.organizationId} organizationName={access.organizationName} />;
}
