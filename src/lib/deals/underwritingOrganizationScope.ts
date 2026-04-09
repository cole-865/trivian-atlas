import { scopeQueryToOrganization } from "@/lib/deals/childOrganizationScope";

type EqCapable = {
  eq: (column: string, value: string) => unknown;
};

export function scopeDealChildQueryToOrganization<T>(
  query: T,
  organizationId: string,
  dealId: string
) {
  return (scopeQueryToOrganization(query, organizationId) as EqCapable).eq(
    "deal_id",
    dealId
  ) as T;
}

export function scopeDealStageQueryToOrganization<T>(
  query: T,
  organizationId: string,
  dealId: string,
  stage: string
) {
  return (scopeDealChildQueryToOrganization(query, organizationId, dealId) as EqCapable).eq(
    "stage",
    stage
  ) as T;
}
