import { revalidatePath } from "next/cache";
import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { getAuthContext } from "@/lib/auth/userRole";
import {
  listCurrentUserNotifications,
  markCurrentUserNotificationsRead,
} from "@/lib/notifications/appNotifications";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

async function markAllNotificationsRead() {
  "use server";

  const supabase = await createClient();
  const authContext = await getAuthContext(supabase);
  const notifications = await listCurrentUserNotifications(supabase, 100);

  if (!authContext.realUser?.id || !authContext.currentOrganizationId) {
    return;
  }

  const unreadIds = notifications
    .filter((notification) => !notification.read_at)
    .map((notification) => notification.id);

  await markCurrentUserNotificationsRead(
    unreadIds,
    authContext.realUser.id,
    authContext.currentOrganizationId
  );

  revalidatePath("/messages");
  revalidatePath("/", "layout");
}

export default async function MessagesPage() {
  const supabase = await createClient();
  const notifications = await listCurrentUserNotifications(supabase, 100);

  return (
    <div className="grid gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xl font-semibold">Messages</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Override requests and status notifications for your current account.
          </div>
        </div>

        <form action={markAllNotificationsRead}>
          <button
            type="submit"
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
          >
            Mark all read
          </button>
        </form>
      </div>

      <div className="rounded-2xl border bg-white shadow-sm">
        <div className="border-b px-4 py-3 text-sm font-medium">
          Recent notifications
        </div>
        <div className="divide-y">
          {notifications.length ? (
            notifications.map((notification) => (
              <div key={notification.id} className="px-4 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-medium">{notification.title}</div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {notification.body}
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {formatDate(notification.created_at)}
                      {notification.read_at ? " • Read" : " • Unread"}
                    </div>
                  </div>

                  {notification.link_href ? (
                    <Link
                      href={notification.link_href}
                      className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                    >
                      Open
                    </Link>
                  ) : null}
                </div>
              </div>
            ))
          ) : (
            <div className="px-4 py-6 text-sm text-muted-foreground">
              No messages yet for this account.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
