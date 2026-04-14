import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { stopImpersonationAction } from "@/lib/auth/impersonationActions";
import { getAuthContext } from "@/lib/auth/userRole";
import { getSwitchableOrganizations } from "@/lib/auth/organizationManagement";
import { OrganizationSwitcher } from "@/components/OrganizationSwitcher";
import { getCurrentUserUnreadNotificationCount } from "@/lib/notifications/appNotifications";
import { AppHeader, AppHeaderInner, AppShell, AppSidebar } from "@/components/app-shell";
import { AppMobileNav, AppSidebarNav } from "@/components/app-shell-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string };

async function DealSearch() {
  // Server component form -> just GETs /deals with querystring
  return (
    <form action="/deals" method="get" className="w-full max-w-2xl">
      <Input
        name="q"
        placeholder="Search deals (name, ID)…"
        className="h-10 border-border/80 bg-card/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
      />
    </form>
  );
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const authContext = await getAuthContext(supabase);
  const switchableOrganizations = await getSwitchableOrganizations(authContext);
  const unreadNotifications = await getCurrentUserUnreadNotificationCount(supabase);
  const showImpersonationBanner =
    authContext.isImpersonating &&
    authContext.impersonatedProfile &&
    authContext.realUser;
  const navItems: NavItem[] = [
    { href: "/home", label: "Home" },
    { href: "/approvals", label: "Approvals" },
    { href: "/messages", label: "Messages" },
    { href: "/deals", label: "Deals" },
    { href: "/settings", label: "Settings" },
    ...(authContext.realRole === "dev" ? [{ href: "/dev-tools", label: "GOD MODE" }] : []),
  ];
  const accountName =
    authContext.currentOrganization?.name ?? "Internal underwriting";
  const accountLabel =
    authContext.currentOrganization
      ? "Current account"
      : "Platform context";

  return (
    <AppShell
      sidebar={
        <AppSidebar>
          <AppSidebarNav
            accountName={accountName}
            accountLabel={accountLabel}
            items={navItems}
          />
        </AppSidebar>
      }
      header={
        <div>
          {showImpersonationBanner && authContext.impersonatedProfile && authContext.realUser ? (
            <div className="border-b border-warning/30 bg-warning/10">
              <div className="flex flex-col gap-3 px-4 py-3 text-sm sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
                <div className="text-warning-foreground">
                  Acting as{" "}
                  <span className="font-semibold">
                    {authContext.impersonatedProfile.fullName ||
                      authContext.impersonatedProfile.email ||
                      authContext.impersonatedProfile.role}
                  </span>
                  . Real user is{" "}
                  <span className="font-semibold">
                    {authContext.realProfile?.fullName ||
                      authContext.realProfile?.email ||
                      authContext.realUser.email}
                  </span>
                  .
                </div>

                <form action={stopImpersonationAction}>
                  <Button type="submit" variant="secondary">
                    Stop impersonating
                  </Button>
                </form>
              </div>
            </div>
          ) : null}

          <AppHeader>
            <AppHeaderInner className="min-h-[4rem] flex-wrap gap-y-2 xl:flex-nowrap">
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <AppMobileNav
                  accountName={accountName}
                  accountLabel={accountLabel}
                  items={navItems}
                />
                <div className="min-w-0 flex-1">
                  <DealSearch />
                </div>
              </div>

              <Card className="w-full min-w-0 border-border/70 bg-card/82 p-2 xl:w-auto xl:min-w-[24rem]">
                <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center">
                  {switchableOrganizations.length ? (
                    <>
                      <OrganizationSwitcher
                        organizations={switchableOrganizations}
                        currentOrganizationId={authContext.currentOrganizationId}
                        compact
                      />
                      <Separator
                        orientation="vertical"
                        className="hidden h-7 xl:block"
                      />
                    </>
                  ) : null}

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button asChild variant="secondary" className="gap-2">
                      <Link href="/messages">
                        Messages
                        {unreadNotifications ? (
                          <Badge
                            variant="default"
                            className={cn(
                              "rounded-full border-0 bg-primary px-2 py-0 text-[10px] tracking-normal text-primary-foreground"
                            )}
                          >
                            {unreadNotifications}
                          </Badge>
                        ) : null}
                      </Link>
                    </Button>
                    <form action="/api/logout" method="post">
                      <Button type="submit">Logout</Button>
                    </form>
                  </div>
                </div>
              </Card>
            </AppHeaderInner>
          </AppHeader>
        </div>
      }
    >
      {children}
    </AppShell>
  );
}
