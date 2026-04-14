import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { hasAdminAccess } from "@/lib/supabase/admin";
import {
  stopImpersonationAction,
  startImpersonationAction,
} from "@/lib/auth/impersonationActions";
import {
  canCreateOrganizations,
  getSwitchableOrganizations,
} from "@/lib/auth/organizationManagement";
import {
  createOrganizationAction,
  setOrganizationActiveStateAction,
} from "@/lib/auth/organizationManagementActions";
import { getAuthContext, type UserProfile } from "@/lib/auth/userRole";
import { CreateOrganizationForm } from "@/components/CreateOrganizationForm";
import { isEmailDeliveryConfigured } from "@/lib/email/mailer";
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

type OrganizationUserRow = {
  user_id: string;
  role: UserProfile["role"];
  is_active: boolean;
};

type StaffProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  is_active: boolean;
};

type StaffProfileListRow = StaffProfileRow & {
  role: UserProfile["role"];
};

function getSearchParam(
  searchParams: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function FlashBanner({
  tone,
  message,
}: {
  tone: "notice" | "error";
  message: string;
}) {
  const className =
    tone === "error"
      ? "border-destructive/35 bg-destructive/10 text-destructive"
      : "border-success/35 bg-success/10 text-success";

  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${className}`}>
      {message}
    </div>
  );
}

function displayProfileName(profile: {
  fullName?: string | null;
  email?: string | null;
  role?: string | null;
}) {
  return profile.fullName || profile.email || profile.role || "Unknown user";
}

function SectionCard({
  eyebrow,
  title,
  description,
  children,
  right,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <Card className="border-border/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
      <CardHeader className="gap-3 pb-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            {eyebrow ? (
              <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-primary">
                {eyebrow}
              </div>
            ) : null}
            <CardTitle className="mt-1.5 text-xl">{title}</CardTitle>
            {description ? (
              <CardDescription className="mt-1 text-sm text-muted-foreground/80">
                {description}
              </CardDescription>
            ) : null}
          </div>
          {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default async function DevToolsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const supabase = await createClient();
  const authContext = await getAuthContext(supabase);

  if (authContext.realRole !== "dev") {
    redirect("/settings");
  }

  const notice = getSearchParam(resolvedSearchParams, "notice");
  const errorMessage = getSearchParam(resolvedSearchParams, "error");
  const currentOrganizationId = authContext.currentOrganizationId;
  const switchableOrganizations = await getSwitchableOrganizations(authContext);
  const adminAccessAvailable = hasAdminAccess();
  const emailDeliveryConfigured = isEmailDeliveryConfigured();

  if (!currentOrganizationId) {
    return (
      <div className="grid gap-6">
        {notice ? <FlashBanner tone="notice" message={notice} /> : null}
        {errorMessage ? <FlashBanner tone="error" message={errorMessage} /> : null}
        {!adminAccessAvailable ? (
          <FlashBanner
            tone="error"
            message="Dev account management requires SUPABASE_SERVICE_ROLE_KEY. Account creation and cross-account admin tools are unavailable until it is configured."
          />
        ) : !emailDeliveryConfigured ? (
          <FlashBanner
            tone="error"
            message="Account creation still works, but initial admin invites will not send until RESEND_API_KEY and EMAIL_FROM are configured."
          />
        ) : null}

        <SectionCard
          eyebrow="Platform"
          title="Dev Tools"
          description="Select or create an account before using account-scoped dev tools."
        >
          {canCreateOrganizations(authContext) && adminAccessAvailable ? (
            <div className="rounded-xl border border-border/75 bg-background/30 p-5">
              <div className="text-base font-semibold text-foreground">Create account</div>
              <div className="mt-1 text-sm text-muted-foreground/80">
                New dealership accounts clone defaults from 865-autos and seed an initial admin invite.
              </div>

              <CreateOrganizationForm action={createOrganizationAction} />

              <div className="mt-4 text-xs uppercase tracking-[0.08em] text-muted-foreground/75">
                Platform dev can switch into any account. {switchableOrganizations.length} accounts are visible in the header switcher.
              </div>
            </div>
          ) : null}
        </SectionCard>
      </div>
    );
  }

  const { data: activeMembershipRows, error: activeMembershipError } = await supabase
    .from("organization_users")
    .select("user_id, role, is_active")
    .eq("organization_id", currentOrganizationId)
    .eq("is_active", true);

  if (activeMembershipError) {
    throw new Error(`Failed to load organization memberships: ${activeMembershipError.message}`);
  }

  const activeMemberships = (activeMembershipRows ?? []) as OrganizationUserRow[];
  const userIds = activeMemberships.map((membership) => membership.user_id);

  const { data: activeStaffRows, error: activeStaffError } = userIds.length
    ? await supabase
        .from("user_profiles")
        .select("id, email, full_name, is_active")
        .in("id", userIds)
        .eq("is_active", true)
    : { data: [], error: null };

  if (activeStaffError) {
    throw new Error(`Failed to load staff profiles: ${activeStaffError.message}`);
  }

  const staffProfiles = new Map(
    ((activeStaffRows ?? []) as StaffProfileRow[]).map((staff) => [staff.id, staff])
  );
  const activeStaff = activeMemberships
    .map((membership) => {
      const profile = staffProfiles.get(membership.user_id);
      if (!profile) {
        return null;
      }

      return {
        ...profile,
        role: membership.role,
      } satisfies StaffProfileListRow;
    })
    .filter((staff): staff is StaffProfileListRow => !!staff)
    .sort((a, b) => {
      const aName = `${a.full_name ?? ""} ${a.email ?? ""}`.trim().toLowerCase();
      const bName = `${b.full_name ?? ""} ${b.email ?? ""}`.trim().toLowerCase();
      return aName.localeCompare(bName);
    });

  return (
    <div className="grid gap-6">
      {notice ? <FlashBanner tone="notice" message={notice} /> : null}
      {errorMessage ? <FlashBanner tone="error" message={errorMessage} /> : null}

      <SectionCard
        eyebrow="Platform"
        title="Dev Tools"
        description="Platform-only account creation and impersonation tools."
        right={
          authContext.currentOrganization?.name ? (
            <Badge variant="secondary">{authContext.currentOrganization.name}</Badge>
          ) : null
        }
      >
        <div className="space-y-6">
          {!adminAccessAvailable ? (
            <FlashBanner
              tone="error"
              message="Dev account management requires SUPABASE_SERVICE_ROLE_KEY. Account creation still needs that key even though the page can render."
            />
          ) : !emailDeliveryConfigured ? (
            <FlashBanner
              tone="error"
              message="Account creation still works, but initial admin invites will not send until RESEND_API_KEY and EMAIL_FROM are configured."
            />
          ) : null}

          {canCreateOrganizations(authContext) && adminAccessAvailable ? (
            <div className="rounded-xl border border-border/75 bg-background/30 p-5">
              <div className="text-base font-semibold text-foreground">Create account</div>
              <div className="mt-1 text-sm text-muted-foreground/80">
                Seed a dealership account from 865-autos defaults and issue the first admin invite.
              </div>

              <CreateOrganizationForm action={createOrganizationAction} />
            </div>
          ) : null}

          <div className="rounded-xl border border-border/75 bg-background/30 px-4 py-3 text-sm">
            Current account:{" "}
            <span className="font-semibold text-foreground">
              {authContext.currentOrganization?.name ?? "Unknown account"}
            </span>
          </div>
        </div>
      </SectionCard>

      {canCreateOrganizations(authContext) && adminAccessAvailable ? (
        <SectionCard
          eyebrow="Accounts"
          title="Visible accounts"
          description="Organizations available to the current platform developer."
        >
          <div className="overflow-hidden rounded-xl border border-border/75 bg-background/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
            {switchableOrganizations.map((account, index) => (
              <div key={account.id}>
                <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-medium text-foreground">{account.name}</div>
                    <div className="mt-1 text-sm text-muted-foreground/80">
                      {account.slug}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={account.isActive ? "success" : "secondary"}>
                      {account.isActive ? "Active" : "Inactive"}
                    </Badge>
                    <form action={setOrganizationActiveStateAction}>
                      <input type="hidden" name="organization_id" value={account.id} />
                      <input
                        type="hidden"
                        name="is_active"
                        value={account.isActive ? "false" : "true"}
                      />
                      <Button type="submit" variant="secondary" size="sm">
                        {account.isActive ? "Deactivate account" : "Reactivate account"}
                      </Button>
                    </form>
                  </div>
                </div>
                {index < switchableOrganizations.length - 1 ? <Separator /> : null}
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}

      <SectionCard
        eyebrow="Impersonation"
        title="User impersonation"
        description="Act as an active staff user for role and workflow testing while keeping your real session intact."
        right={
          authContext.isImpersonating ? <Badge variant="warning">Impersonating</Badge> : null
        }
      >
        <div className="space-y-5">
          <div className="grid gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4">
            <div className="text-sm font-medium text-warning-foreground">
              Real user: {authContext.realUser?.email ?? "Unknown user"}
            </div>
            <div className="text-sm text-warning-foreground/85">
              Effective user:{" "}
              {authContext.isImpersonating && authContext.impersonatedProfile
                ? displayProfileName(authContext.impersonatedProfile)
                : displayProfileName({
                    fullName: authContext.realProfile?.fullName ?? null,
                    email: authContext.realProfile?.email ?? authContext.realUser?.email ?? null,
                    role: authContext.realRole,
                  })}
            </div>
          </div>

          <form action={startImpersonationAction} className="grid gap-3 md:max-w-xl">
            <label className="grid gap-2">
              <span className="text-sm font-medium text-foreground">Act as user</span>
              <select
                name="impersonated_user_id"
                defaultValue={authContext.impersonatedUserId ?? ""}
                className="h-10 rounded-lg border border-input bg-input/45 px-3 py-2 text-sm text-foreground shadow-sm outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Select an active staff user</option>
                {activeStaff.map((staff) => (
                  <option key={staff.id} value={staff.id}>
                    {staff.full_name || staff.email || staff.id} ({staff.role})
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-wrap gap-3">
              <Button type="submit">Start impersonating</Button>
            </div>

            <div className="text-xs uppercase tracking-[0.08em] text-muted-foreground/75">
              Only active users in the current account appear here. Non-dev users cannot start or stop impersonation.
            </div>
          </form>

          {authContext.isImpersonating ? (
            <form action={stopImpersonationAction}>
              <Button type="submit" variant="secondary">
                Stop impersonating
              </Button>
            </form>
          ) : null}

          <div className="overflow-hidden rounded-xl border border-border/75 bg-background/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
            {activeStaff.map((staff, index) => (
              <div key={staff.id}>
                <div className="flex items-center justify-between gap-3 px-4 py-3.5 text-sm">
                  <div>
                    <div className="font-medium text-foreground">
                      {staff.full_name || staff.email || staff.id}
                    </div>
                    <div className="text-muted-foreground/80">{staff.email || staff.id}</div>
                  </div>
                  <Badge variant="secondary">{staff.role}</Badge>
                </div>
                {index < activeStaff.length - 1 ? <Separator /> : null}
              </div>
            ))}
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
