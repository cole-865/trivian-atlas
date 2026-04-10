import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentOrganizationId } from "@/lib/auth/organizationContext";
import type { Json } from "@/lib/supabase/database.types";

export type AppNotificationType =
  | "deal_override_requested"
  | "deal_override_approved"
  | "deal_override_denied"
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
