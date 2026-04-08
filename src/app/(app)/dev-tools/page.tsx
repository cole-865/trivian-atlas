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
      ? "border-red-200 bg-red-50 text-red-900"
      : "border-emerald-200 bg-emerald-50 text-emerald-900";

  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm ${className}`}>
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

        <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="text-xl font-semibold">Dev Tools</div>
        <div className="mt-2 text-sm text-muted-foreground">
            Select or create an account before using account-scoped dev tools.
        </div>

          {canCreateOrganizations(authContext) && adminAccessAvailable ? (
            <div className="mt-6 rounded-2xl border border-gray-200 p-4">
              <div className="text-base font-semibold">Create account</div>
              <div className="mt-1 text-sm text-muted-foreground">
                New dealership accounts clone defaults from 865-autos and seed an initial admin invite.
              </div>

              <CreateOrganizationForm action={createOrganizationAction} />

              <div className="mt-4 text-xs text-muted-foreground">
                Platform dev can switch into any account. {switchableOrganizations.length} accounts are visible in the top-right switcher.
              </div>
            </div>
          ) : null}
        </div>
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

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="text-xl font-semibold">Dev Tools</div>
        <div className="mt-2 text-sm text-muted-foreground">
          Platform-only account creation and impersonation tools.
        </div>

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
          <div className="mt-6 rounded-2xl border border-gray-200 p-4">
            <div className="text-base font-semibold">Create account</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Seed a dealership account from 865-autos defaults and issue the first admin invite.
            </div>

            <CreateOrganizationForm action={createOrganizationAction} />
          </div>
        ) : null}

        <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
          Current account:{" "}
          <span className="font-medium">
            {authContext.currentOrganization?.name ?? "Unknown account"}
          </span>
        </div>

        {canCreateOrganizations(authContext) && adminAccessAvailable ? (
          <div className="mt-6 rounded-2xl border border-gray-200 bg-white">
            <div className="border-b px-4 py-3 text-sm font-medium">Accounts</div>
            <div className="divide-y">
              {switchableOrganizations.map((account) => (
                <div
                  key={account.id}
                  className="flex items-center justify-between gap-3 px-4 py-4 text-sm"
                >
                  <div>
                    <div className="font-medium">{account.name}</div>
                    <div className="text-muted-foreground">
                      {account.slug} {account.isActive ? "" : "(inactive)"}
                    </div>
                  </div>
                  <form action={setOrganizationActiveStateAction} className="flex items-center gap-2">
                    <input type="hidden" name="organization_id" value={account.id} />
                    <input
                      type="hidden"
                      name="is_active"
                      value={account.isActive ? "false" : "true"}
                    />
                    <button
                      type="submit"
                      className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                    >
                      {account.isActive ? "Deactivate account" : "Reactivate account"}
                    </button>
                  </form>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="text-base font-semibold text-amber-950">User impersonation</div>
          <div className="mt-2 text-sm text-amber-900/80">
            Act as an active staff user for role and workflow testing while keeping your real
            authenticated session intact.
          </div>

          <div className="mt-4 grid gap-3 rounded-2xl border border-amber-200 bg-white/70 p-4">
            <div className="text-sm font-medium text-amber-900">
              Real user: {authContext.realUser?.email ?? "Unknown user"}
            </div>
            <div className="text-sm text-amber-900/80">
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

          <form action={startImpersonationAction} className="mt-4 grid gap-3 md:max-w-xl">
            <label className="grid gap-2">
              <span className="text-sm font-medium text-amber-950">Act as user</span>
              <select
                name="impersonated_user_id"
                defaultValue={authContext.impersonatedUserId ?? ""}
                className="rounded-xl border px-3 py-2 text-sm"
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
              <button
                type="submit"
                className="rounded-xl bg-black px-4 py-2 text-sm text-white hover:opacity-90"
              >
                Start impersonating
              </button>
            </div>

            <div className="text-xs text-amber-900/70">
              Only active users in the current account appear here. Non-dev users cannot start
              or stop impersonation.
            </div>
          </form>

          <div className="mt-4 rounded-2xl border border-gray-200 bg-white">
            <div className="border-b px-4 py-3 text-sm font-medium">
              Active staff users in this account
            </div>
            <div className="divide-y">
              {activeStaff.map((staff) => (
                <div
                  key={staff.id}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                >
                  <div>
                    <div className="font-medium">
                      {staff.full_name || staff.email || staff.id}
                    </div>
                    <div className="text-muted-foreground">{staff.email || staff.id}</div>
                  </div>
                  <div className="rounded-full border px-2 py-1 text-xs uppercase tracking-wide">
                    {staff.role}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {authContext.isImpersonating ? (
            <form action={stopImpersonationAction} className="mt-3">
              <button
                type="submit"
                className="rounded-xl border px-4 py-2 text-sm hover:bg-white"
              >
                Stop impersonating
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}
