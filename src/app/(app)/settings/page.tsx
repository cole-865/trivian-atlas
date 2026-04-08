import Link from "next/link";
import { revalidatePath } from "next/cache";
import { hasPermission } from "@/lib/auth/permissions";
import {
  ORG_MANAGED_ROLES,
  canManageCurrentOrganization,
  getSwitchableOrganizations,
  loadOrganizationManagementData,
} from "@/lib/auth/organizationManagement";
import {
  createOrganizationInviteAction,
  resendOrganizationInviteAction,
  revokeOrganizationInviteAction,
  updateOrganizationMembershipAction,
} from "@/lib/auth/organizationManagementActions";
import { isEmailDeliveryConfigured } from "@/lib/email/mailer";
import { getAuthContext, getCurrentUserRole } from "@/lib/auth/userRole";
import { OrganizationSwitcher } from "@/components/OrganizationSwitcher";
import {
  getStepEnforcementEnabled,
  setStepEnforcementEnabled,
} from "@/lib/settings/appSettings";
import { createClient } from "@/utils/supabase/server";
import { hasAdminAccess } from "@/lib/supabase/admin";

function canManageStepEnforcement(role: Awaited<ReturnType<typeof getCurrentUserRole>>) {
  return !!role && (
    hasPermission(role, "edit_settings") ||
    hasPermission(role, "access_debug_tools")
  );
}

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

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function displayUserName(user: { fullName?: string | null; email?: string | null; userId?: string }) {
  return user.fullName || user.email || user.userId || "Unknown user";
}

async function updateStepEnforcementSetting(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const role = await getCurrentUserRole(supabase);

  if (!canManageStepEnforcement(role)) {
    return;
  }

  const enabled = formData.get("step_enforcement_enabled") === "on";
  const { error } = await setStepEnforcementEnabled(supabase, enabled);

  if (error) {
    throw new Error(`Failed to save step enforcement setting: ${error.message}`);
  }

  revalidatePath("/settings");
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const supabase = await createClient();
  const authContext = await getAuthContext(supabase);
  const role = await getCurrentUserRole(supabase);
  const showStepEnforcementToggle = canManageStepEnforcement(role);
  const stepEnforcementEnabled = showStepEnforcementToggle
    ? await getStepEnforcementEnabled(supabase)
    : true;
  const switchableOrganizations = await getSwitchableOrganizations(authContext);
  const adminAccessAvailable = hasAdminAccess();
  const emailDeliveryConfigured = isEmailDeliveryConfigured();
  const showInactiveUsers = getSearchParam(resolvedSearchParams, "showInactive") === "1";
  const canManageUsers = canManageCurrentOrganization(authContext);
  const managementData =
    canManageUsers && authContext.currentOrganizationId
      ? await loadOrganizationManagementData(authContext.currentOrganizationId)
      : null;
  const notice = getSearchParam(resolvedSearchParams, "notice");
  const error = getSearchParam(resolvedSearchParams, "error");

  return (
    <div className="grid gap-6">
      {notice ? <FlashBanner tone="notice" message={notice} /> : null}
      {error ? <FlashBanner tone="error" message={error} /> : null}
      {canManageUsers && !adminAccessAvailable ? (
        <FlashBanner
          tone="error"
          message="Account management requires SUPABASE_SERVICE_ROLE_KEY. User/invite administration is unavailable until it is configured."
        />
      ) : null}
      {canManageUsers && adminAccessAvailable && !emailDeliveryConfigured ? (
        <FlashBanner
          tone="error"
          message="Account invitations are being created, but email delivery is not configured yet. Set RESEND_API_KEY and EMAIL_FROM to send invite emails automatically."
        />
      ) : null}

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="text-xl font-semibold">Settings</div>
        <div className="mt-2 text-sm text-muted-foreground">
          Account-scoped settings and access management.
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(260px,360px)]">
          <div className="rounded-2xl border border-gray-200 p-4">
            <div className="text-sm font-medium">Current account</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Authorization and account-owned settings resolve against the active dealership.
            </div>

            <div className="mt-4 rounded-xl border bg-gray-50 px-4 py-3 text-sm">
              <div className="font-medium">
                {authContext.currentOrganization?.name ?? "No account selected"}
              </div>
              <div className="mt-1 text-muted-foreground">
                {authContext.currentOrganization?.slug
                  ? `Slug: ${authContext.currentOrganization.slug}`
                  : "Select an account to manage dealership-scoped settings."}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 p-4">
            <OrganizationSwitcher
              organizations={switchableOrganizations}
              currentOrganizationId={authContext.currentOrganizationId}
            />
          </div>
        </div>
      </div>

      {canManageUsers && managementData && authContext.currentOrganization && adminAccessAvailable ? (
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
          <div className="text-lg font-semibold">Account users</div>
          <div className="mt-1 text-sm text-muted-foreground">
                Manage memberships and invitations for {authContext.currentOrganization.name}.
              </div>
            </div>

            <Link
              href={showInactiveUsers ? "/settings" : "/settings?showInactive=1"}
              className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
            >
              {showInactiveUsers ? "Hide inactive users" : "Show inactive users"}
            </Link>
          </div>

          <form action={createOrganizationInviteAction} className="mt-6 grid gap-4 rounded-2xl border border-gray-200 p-4 md:grid-cols-4">
            <label className="grid gap-2">
              <span className="text-sm font-medium">Name</span>
              <input
                name="full_name"
                required
                className="rounded-xl border px-3 py-2 text-sm"
                placeholder="Jordan Example"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Email</span>
              <input
                name="email"
                type="email"
                required
                className="rounded-xl border px-3 py-2 text-sm"
                placeholder="jordan@example.com"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Role</span>
              <select name="role" defaultValue="sales" className="rounded-xl border px-3 py-2 text-sm">
                {ORG_MANAGED_ROLES.map((orgRole) => (
                  <option key={orgRole} value={orgRole}>
                    {orgRole}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-end">
              <button
                type="submit"
                className="rounded-xl bg-black px-4 py-2 text-sm text-white hover:opacity-90"
              >
                Send invite
              </button>
            </div>
          </form>

          <div className="mt-6 rounded-2xl border border-gray-200 bg-white">
            <div className="border-b px-4 py-3 text-sm font-medium">Active users</div>
            <div className="divide-y">
              {managementData.activeUsers.length ? (
                managementData.activeUsers.map((member) => (
                  <div key={member.userId} className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_220px_220px]">
                    <div>
                      <div className="font-medium">
                        {displayUserName(member)}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {member.email || member.userId}
                      </div>
                    </div>

                    <form action={updateOrganizationMembershipAction} className="flex items-center gap-2">
                      <input type="hidden" name="user_id" value={member.userId} />
                      <select
                        name="role"
                        defaultValue={member.role}
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                      >
                        {ORG_MANAGED_ROLES.map((orgRole) => (
                          <option key={orgRole} value={orgRole}>
                            {orgRole}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                      >
                        Save
                      </button>
                    </form>

                    <form action={updateOrganizationMembershipAction} className="flex items-center justify-start lg:justify-end">
                      <input type="hidden" name="user_id" value={member.userId} />
                      <input type="hidden" name="is_active" value="false" />
                      <button
                        type="submit"
                        className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                      >
                        Deactivate
                      </button>
                    </form>
                  </div>
                ))
              ) : (
                <div className="px-4 py-6 text-sm text-muted-foreground">
                  No active users are assigned to this account yet.
                </div>
              )}
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-gray-200 bg-white">
            <div className="border-b px-4 py-3 text-sm font-medium">Pending invites</div>
            <div className="divide-y">
              {managementData.pendingInvites.length ? (
                managementData.pendingInvites.map((invite) => (
                  <div key={invite.id} className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_220px]">
                    <div>
                      <div className="font-medium">
                        {invite.fullName || invite.email}
                      </div>
                      <div className="text-sm text-muted-foreground">{invite.email}</div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span className="rounded-full border px-2 py-1 uppercase tracking-wide">
                          {invite.role}
                        </span>
                        <span>Status: {invite.status}</span>
                        <span>Invited by: {invite.invitedBy}</span>
                        <span>Sent: {formatDateTime(invite.sentAt)}</span>
                        <span>Expires: {formatDateTime(invite.expiresAt)}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-start justify-start gap-2 lg:justify-end">
                      <form action={resendOrganizationInviteAction}>
                        <input type="hidden" name="invite_id" value={invite.id} />
                        <button
                          type="submit"
                          className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                        >
                          Resend
                        </button>
                      </form>

                      <form action={revokeOrganizationInviteAction}>
                        <input type="hidden" name="invite_id" value={invite.id} />
                        <button
                          type="submit"
                          className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                        >
                          Revoke
                        </button>
                      </form>
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-4 py-6 text-sm text-muted-foreground">
                  No pending invites for this account.
                </div>
              )}
            </div>
          </div>

          {showInactiveUsers ? (
            <div className="mt-6 rounded-2xl border border-gray-200 bg-white">
              <div className="border-b px-4 py-3 text-sm font-medium">Inactive users</div>
              <div className="divide-y">
                {managementData.inactiveUsers.length ? (
                  managementData.inactiveUsers.map((member) => (
                    <div key={member.userId} className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_220px_220px]">
                      <div>
                        <div className="font-medium">
                          {displayUserName(member)}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {member.email || member.userId}
                        </div>
                      </div>

                      <div className="flex items-center text-sm text-muted-foreground">
                        Role on deactivated membership: {member.role}
                      </div>

                      <form action={updateOrganizationMembershipAction} className="flex items-center justify-start lg:justify-end">
                        <input type="hidden" name="user_id" value={member.userId} />
                        <input type="hidden" name="is_active" value="true" />
                        <button
                          type="submit"
                          className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                        >
                          Reactivate
                        </button>
                      </form>
                    </div>
                  ))
                ) : (
                  <div className="px-4 py-6 text-sm text-muted-foreground">
                    No inactive memberships for this account.
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {showStepEnforcementToggle ? (
        <form action={updateStepEnforcementSetting}>
          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <div className="text-sm font-medium">Workflow step enforcement</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Keep workflow step gating enabled for the current account.
            </div>

            <label className="mt-4 flex items-start gap-3">
              <input
                type="checkbox"
                name="step_enforcement_enabled"
                defaultChecked={stepEnforcementEnabled}
                className="mt-1 h-4 w-4 rounded border-gray-300"
              />
              <div>
                <div className="text-sm font-medium">
                  Enable step enforcement
                </div>
                <div className="text-sm text-muted-foreground">
                  When disabled, debug workflows can bypass step enforcement inside this account.
                </div>
              </div>
            </label>

            <div className="mt-4">
              <button
                type="submit"
                className="rounded-xl bg-black px-4 py-2 text-sm text-white hover:opacity-90"
              >
                Save settings
              </button>
            </div>
          </div>
        </form>
      ) : null}
    </div>
  );
}
