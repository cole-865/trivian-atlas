import { scopeQueryToOrganization } from "@/lib/deals/childOrganizationScope";

export function scopeDealChildQueryToOrganization<
  T extends { eq: (column: string, value: string) => unknown },
>(query: T, organizationId: string, dealId: string) {
  return scopeQueryToOrganization(query, organizationId).eq("deal_id", dealId) as T;
}

export function scopeDealStageQueryToOrganization<
  T extends { eq: (column: string, value: string) => unknown },
>(query: T, organizationId: string, dealId: string, stage: string) {
  return scopeDealChildQueryToOrganization(query, organizationId, dealId).eq(
    "stage",
    stage
  ) as T;
}
