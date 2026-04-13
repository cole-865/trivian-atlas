import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentOrganizationId } from "@/lib/auth/organizationContext";
import type { Json } from "@/lib/supabase/database.types";

export type AppNotificationType =
  | "deal_funded"
  | "deal_funding_rejected"
  | "deal_funding_review"
  | "deal_override_requested"
  | "deal_override_approved"
  | "deal_override_denied"
  | "deal_override_countered"
  | "deal_override_stale";

type AppNotificationRow = {
  id: string;
  organization_id: string;
  user_id: string;
  type: AppNotificationType;
  deal_id: string | null;
  override_request_id: string | null;
  title: string;
  body: string;
  link_href: string | null;
  metadata_json: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
};

type SupabaseLike = {
  auth: {
    getUser: () => Promise<{
      data: { user: { id: string } | null };
      error?: { message: string } | null;
    }>;
  };
};

export async function createAppNotifications(args: {
  organizationId: string;
  userIds: string[];
  type: AppNotificationType;
  dealId?: string | null;
  overrideRequestId?: string | null;
  title: string;
  body: string;
  linkHref?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const admin = createAdminClient();
  const uniqueUserIds = Array.from(new Set(args.userIds.filter(Boolean)));

  if (!uniqueUserIds.length) {
    return;
  }

  const rows = uniqueUserIds.map((userId) => ({
    organization_id: args.organizationId,
    user_id: userId,
    type: args.type,
    deal_id: args.dealId ?? null,
    override_request_id: args.overrideRequestId ?? null,
    title: args.title,
    body: args.body,
    link_href: args.linkHref ?? null,
    metadata_json: (args.metadata ?? null) as Json,
  }));

  const { error } = await admin.from("app_notifications").insert(rows);

  if (error) {
    throw new Error(`Failed to create notifications: ${error.message}`);
  }
}

export async function createDealFundingReviewNotifications(args: {
  organizationId: string;
  dealId: string;
  customerName: string | null;
}) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("organization_users")
    .select("user_id")
    .eq("organization_id", args.organizationId)
    .eq("is_active", true)
    .in("role", ["management", "admin"]);

  if (error) {
    throw new Error(`Failed to load funding notification recipients: ${error.message}`);
  }

  const customerName = args.customerName?.trim() || "Customer";

  await createAppNotifications({
    organizationId: args.organizationId,
    userIds: (data ?? []).map((row) => row.user_id),
    type: "deal_funding_review",
    dealId: args.dealId,
    title: "Funding review ready",
    body: `${customerName} is ready for funding review.`,
    linkHref: `/deals/${args.dealId}/fund`,
    metadata: {
      customerName,
    },
  });
}

export async function createDealFundingOutcomeNotifications(args: {
  organizationId: string;
  dealId: string;
  dealNumber?: string | null;
  customerName: string | null;
  salespersonUserId?: string | null;
  submittedByUserId?: string | null;
  outcome: "funded" | "rejected";
  reason?: string | null;
}) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("organization_users")
    .select("user_id")
    .eq("organization_id", args.organizationId)
    .eq("is_active", true)
    .in("role", ["management", "admin"]);

  if (error) {
    throw new Error(`Failed to load funding outcome notification recipients: ${error.message}`);
  }

  const customerName = args.customerName?.trim() || "Deal";
  const dealLabel = args.dealNumber?.trim() || args.dealId;
  const managementUserIds = (data ?? []).map((row) => row.user_id);
  const userIds = [
    ...managementUserIds,
    args.salespersonUserId ?? null,
    args.submittedByUserId ?? null,
  ].filter((userId): userId is string => !!userId);
  const isFunded = args.outcome === "funded";
  const reason = args.reason?.trim() || "No reason provided.";

  await createAppNotifications({
    organizationId: args.organizationId,
    userIds,
    type: isFunded ? "deal_funded" : "deal_funding_rejected",
    dealId: args.dealId,
    title: isFunded ? "Deal funded" : "Funding rejected",
    body: isFunded
      ? `Deal #${dealLabel} is funded. No further review!`
      : `Deal #${dealLabel} funding rejected: ${reason}`,
    linkHref: `/deals/${args.dealId}/fund`,
    metadata: {
      customerName,
      reason: isFunded ? null : reason,
    },
  });
}

export async function listCurrentUserNotifications(
  supabase: unknown,
  limit = 50
) {
  const client = supabase as SupabaseLike & {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          order: (
            column: string,
            options?: { ascending: boolean }
          ) => {
            limit: (
              value: number
            ) => Promise<{
              data: AppNotificationRow[] | null;
              error: { message: string } | null;
            }>;
          };
        };
      };
    };
  };

  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser();

  if (authError) {
    throw new Error(`Failed to load current user: ${authError.message}`);
  }

  if (!user?.id) {
    return [];
  }

  const organizationId = await getCurrentOrganizationId(client);
  if (!organizationId) {
    return [];
  }

  const notificationsQuery = ((client
    .from("app_notifications")
    .select(
      "id, organization_id, user_id, type, deal_id, override_request_id, title, body, link_href, metadata_json, read_at, created_at"
    )) as unknown as {
    eq: (column: string, value: string) => {
      eq: (column: string, value: string) => {
        order: (
          column: string,
          options?: { ascending: boolean }
        ) => {
          limit: (
            value: number
          ) => Promise<{
            data: AppNotificationRow[] | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
  });

  const { data, error } = await notificationsQuery
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error?.message.includes("app_notifications")) {
    return [];
  }

  if (error) {
    throw new Error(`Failed to load notifications: ${error.message}`);
  }

  return (data ?? []) as AppNotificationRow[];
}

export async function getCurrentUserUnreadNotificationCount(supabase: unknown) {
  const notifications = await listCurrentUserNotifications(supabase, 100);
  return notifications.filter((notification) => !notification.read_at).length;
}

export async function markCurrentUserNotificationsRead(
  notificationIds: string[],
  userId: string,
  organizationId: string
) {
  if (!notificationIds.length) {
    return;
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("app_notifications")
    .update({
      read_at: new Date().toISOString(),
    })
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .in("id", notificationIds);

  if (error?.message.includes("app_notifications")) {
    return;
  }

  if (error) {
    throw new Error(`Failed to mark notifications read: ${error.message}`);
  }
}
