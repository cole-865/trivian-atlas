import { revalidatePath } from "next/cache";
import Link from "next/link";
import { ArrowUpRight, Bell } from "lucide-react";
import { createClient } from "@/utils/supabase/server";
import { getAuthContext } from "@/lib/auth/userRole";
import {
  listCurrentUserNotifications,
  markCurrentUserNotificationsRead,
} from "@/lib/notifications/appNotifications";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { EmptyState } from "@/components/atlas/page";

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
  const unreadCount = notifications.filter((notification) => !notification.read_at).length;

  return (
    <div className="grid gap-6">
      <Card className="border-border/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
        <CardHeader className="gap-3 pb-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-primary">
                Notifications
              </div>
              <CardTitle className="mt-1.5 text-xl">Messages</CardTitle>
              <CardDescription className="mt-1 text-sm text-muted-foreground/80">
                Override requests and status notifications for your current account.
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={unreadCount ? "default" : "secondary"}>
                {unreadCount ? `${unreadCount} unread` : "All caught up"}
              </Badge>
              <form action={markAllNotificationsRead}>
                <Button type="submit" variant="secondary">
                  Mark all read
                </Button>
              </form>
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card className="border-border/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-lg">Recent notifications</CardTitle>
              <CardDescription className="mt-1 text-xs uppercase tracking-[0.08em] text-muted-foreground/75">
                Latest account activity
              </CardDescription>
            </div>
            <Bell className="size-4 text-muted-foreground/70" />
          </div>
        </CardHeader>
        <CardContent>
          {notifications.length ? (
            <div className="overflow-hidden rounded-xl border border-border/75 bg-background/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
              {notifications.map((notification, index) => (
                <div key={notification.id}>
                  <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium text-foreground">
                          {notification.title}
                        </div>
                        <Badge variant={notification.read_at ? "secondary" : "default"}>
                          {notification.read_at ? "Read" : "Unread"}
                        </Badge>
                      </div>
                      <div className="mt-1.5 text-sm text-muted-foreground/82">
                        {notification.body}
                      </div>
                      <div className="mt-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
                        {formatDate(notification.created_at)}
                      </div>
                    </div>

                    {notification.link_href ? (
                      <Button asChild variant="secondary" size="sm">
                        <Link href={notification.link_href}>
                          Open
                          <ArrowUpRight />
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                  {index < notifications.length - 1 ? <Separator /> : null}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              className="min-h-36"
              title="No messages yet"
              description="There are no notifications for this account right now."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
