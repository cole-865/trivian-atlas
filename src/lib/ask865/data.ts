import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeDashboard, type RawRow } from "./normalize";
import type { DashboardFilters } from "./types";

// Call only after getAsk865Access resolves the server's current organization.
export async function loadDashboard(organizationId:string,filters:DashboardFilters) {
 const {data,error}=await createAdminClient().rpc("atlas_ask865_dashboard",{
   p_organization_id:organizationId,p_from:filters.from,p_to:filters.to,
   p_salesperson:filters.salesperson,p_lender:filters.lender,p_inventory_status:filters.inventoryStatus,
 });
 if(error || !data) throw new Error("Reporting data is unavailable");
 return normalizeDashboard(data as unknown as Record<string,RawRow[]>,filters);
}
