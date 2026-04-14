import Link from "next/link";
import { hasAdminAccess } from "@/lib/supabase/admin";
import { isEmailDeliveryConfigured } from "@/lib/email/mailer";
import { createClient } from "@/utils/supabase/server";
import { getAuthContext } from "@/lib/auth/userRole";
import { canManageCurrentOrganization } from "@/lib/auth/organizationManagement";
import { ORG_MANAGED_ROLES, loadOrganizationManagementData } from "@/lib/auth/organizationManagement";
import {
  createOrganizationInviteAction,
  resendOrganizationInviteAction,
  revokeOrganizationInviteAction,
  updateOrganizationMembershipAction,
} from "@/lib/auth/organizationManagementActions";
import { DEALERSHIP_PERMISSION_KEYS, DEFAULT_ROLE_PERMISSION_PRESETS } from "@/lib/auth/permissionRegistry";
import { SaveButton, SettingsForm } from "./SettingsForm";
import { UnderwritingTierCards } from "./UnderwritingTierCards";
import { VehicleTermPolicyCards } from "./VehicleTermPolicyCards";
import { getResolvedDealershipPermissions } from "@/lib/auth/dealershipPermissions";
import {
  DEFAULT_WORKFLOW_SETTINGS,
  getWorkflowSettings,
  type WorkflowSettings,
} from "@/lib/settings/appSettings";
import {
  buildRolePermissionMatrix,
  loadDealershipSettingsData,
  type DealershipSettingsData,
} from "@/lib/settings/dealershipSettings";
import {
  updateGeneralSettingsAction,
  updateIntegrationsAction,
  updateNotificationsAction,
  updateRolePermissionsAction,
  updateTrivianConfigAction,
  updateUserPermissionOverrideAction,
  updateWorkflowSettingsAction,
} from "@/lib/settings/dealershipSettingsActions";

const SECTIONS = [
  ["general", "General"],
  ["users", "Users & Roles"],
  ["permissions", "Permissions"],
  ["underwriting", "Underwriting"],
  ["workflow", "Deal Workflow"],
  ["products", "Products & Pricing"],
  ["notifications", "Notifications"],
  ["integrations", "Integrations"],
  ["audit", "Audit / Compliance"],
] as const;

const VISIBLE_PERMISSION_KEYS = DEALERSHIP_PERMISSION_KEYS.filter(
  (permission) => permission !== "approve_overrides"
);

type Section = (typeof SECTIONS)[number][0];
type ManagementData = Awaited<ReturnType<typeof loadOrganizationManagementData>>;

function param(searchParams: Record<string, string | string[] | undefined>, key: string) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function section(value: string | undefined): Section {
  return SECTIONS.some(([key]) => key === value) ? (value as Section) : "general";
}

function date(value: string | null | undefined) {
  return value
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
    : "Not available";
}

function lastAuditDate(data: DealershipSettingsData, entityTypes: string[]) {
  return data.auditLogs.find((log) => log.entity_type && entityTypes.includes(log.entity_type))?.created_at;
}

function EffectNote({ children }: { children: React.ReactNode }) {
  return <div className="mt-2 text-xs text-muted-foreground">{children}</div>;
}

function name(user: { fullName?: string | null; email?: string | null; userId?: string }) {
  return user.fullName || user.email || user.userId || "Unknown user";
}

function permissionLabel(permission: string) {
  return permission.replaceAll("_", " ");
}

function Banner({ tone, children }: { tone: "notice" | "error"; children: React.ReactNode }) {
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${tone === "error" ? "border-red-200 bg-red-50 text-red-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
      {children}
    </div>
  );
}

function Header({ title, text, meta }: { title: string; text: string; meta?: string }) {
  return (
    <div className="mb-5">
      <div className="text-lg font-semibold">{title}</div>
      <div className="mt-1 text-sm text-muted-foreground">{text}</div>
      {meta ? <div className="mt-2 text-xs text-muted-foreground">{meta}</div> : null}
    </div>
  );
}

function Field({
  label,
  name,
  value,
  type = "text",
  required,
  helper,
  min,
  max,
  step,
  suffix,
}: {
  label: string;
  name: string;
  value?: string | number | null;
  type?: string;
  required?: boolean;
  helper?: string;
  min?: string | number;
  max?: string | number;
  step?: string | number;
  suffix?: string;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium">{label}</span>
      {suffix ? (
        <span className="flex overflow-hidden rounded-lg border bg-white focus-within:ring-1 focus-within:ring-black">
          <input name={name} type={type} required={required} min={min} max={max} step={step} defaultValue={value ?? ""} className="min-w-0 flex-1 border-0 px-3 py-2 text-sm outline-none" />
          <span className="border-l bg-gray-50 px-3 py-2 text-sm text-muted-foreground">{suffix}</span>
        </span>
      ) : (
        <input name={name} type={type} required={required} min={min} max={max} step={step} defaultValue={value ?? ""} className="rounded-lg border px-3 py-2 text-sm" />
      )}
      {helper ? <span className="text-xs text-muted-foreground">{helper}</span> : null}
    </label>
  );
}

function Toggle({
  name,
  label,
  text,
  checked,
}: {
  name: string;
  label: string;
  text: string;
  checked: boolean;
}) {
  return (
    <label className="flex items-start gap-3 rounded-lg border px-3 py-3">
      <input type="checkbox" name={name} defaultChecked={checked} className="mt-1 h-4 w-4 rounded border-gray-300" />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-sm text-muted-foreground">{text}</span>
      </span>
    </label>
  );
}

function Button({ children = "Save changes", variant = "primary", disabledWhenPristine = true }: { children?: React.ReactNode; variant?: "primary" | "secondary"; disabledWhenPristine?: boolean }) {
  return <SaveButton variant={variant} disabledWhenPristine={disabledWhenPristine}>{children}</SaveButton>;
}

function General({ data }: { data: DealershipSettingsData }) {
  const org = data.organization;
  const profile = data.profile;
  return (
    <SettingsForm action={updateGeneralSettingsAction} className="rounded-lg border bg-white p-6 shadow-sm">
      <Header title="General" text="Dealership identity, contact details, and account defaults." meta={`Last updated: ${date(org?.updated_at)}`} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Dealership display name" name="display_name" value={org?.name} required />
        <Field label="Account slug" name="slug" value={org?.slug} required />
        <Field label="Legal business name" name="legal_business_name" value={profile?.legal_business_name} />
        <Field label="DBA name" name="dba_name" value={profile?.dba_name} />
        <Field label="Phone" name="phone" value={profile?.phone} />
        <Field label="Website" name="website" value={profile?.website} />
        <Field label="Main email" name="main_email" type="email" value={profile?.main_email} />
        <Field label="Timezone" name="timezone" value={profile?.timezone ?? "America/New_York"} />
        <Field label="Address" name="address_line1" value={profile?.address_line1} />
        <Field label="Address line 2" name="address_line2" value={profile?.address_line2} />
        <Field label="City" name="city" value={profile?.city} />
        <Field label="State" name="state" value={profile?.state} />
        <Field label="Postal code" name="postal_code" value={profile?.postal_code} />
        <Field label="Country" name="country" value={profile?.country ?? "US"} />
      </div>
      <div className="mt-5 rounded-lg border bg-gray-50 px-4 py-3 text-sm text-muted-foreground">Logo upload placeholder: storage path support exists in the model, but upload plumbing is intentionally not wired in this pass.</div>
      <div className="mt-5"><Button /></div>
    </SettingsForm>
  );
}

function InviteForm() {
  return (
    <SettingsForm action={createOrganizationInviteAction} disableSaveUntilDirty={false} className="grid gap-4 rounded-lg border p-4 md:grid-cols-4">
      <Field label="Name" name="full_name" required />
      <Field label="Email" name="email" type="email" required />
      <label className="grid gap-2">
        <span className="text-sm font-medium">Role</span>
        <select name="role" defaultValue="sales" className="rounded-lg border px-3 py-2 text-sm">
          {ORG_MANAGED_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
        </select>
      </label>
      <div className="flex items-end"><Button disabledWhenPristine={false}>Send invite</Button></div>
    </SettingsForm>
  );
}

function Users({ data }: { data: ManagementData | null }) {
  if (!data) {
    return <div className="rounded-lg border bg-white p-6 shadow-sm"><Header title="Users & Roles" text="User management is unavailable without account management permission." /></div>;
  }

  return (
    <div className="rounded-lg border bg-white p-6 shadow-sm">
      <Header title="Users & Roles" text="Invite staff and manage active, pending, and inactive account access." />
      <InviteForm />
      <div className="mt-6 grid gap-5">
        <div className="rounded-lg border">
          <div className="border-b px-4 py-3 text-sm font-medium">Active</div>
          {data.activeUsers.length ? data.activeUsers.map((member) => (
            <div key={member.userId} className="grid gap-4 border-b px-4 py-4 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_180px_140px]">
              <div>
                <div className="font-medium">{name(member)}</div>
                <div className="text-sm text-muted-foreground">{member.email || member.userId}</div>
                <div className="mt-2 text-xs text-muted-foreground">Last active: not available. Member since {date(member.createdAt)}.</div>
              </div>
              <SettingsForm action={updateOrganizationMembershipAction} className="grid content-start gap-2">
                <input type="hidden" name="user_id" value={member.userId} />
                <select name="role" defaultValue={member.role} className="rounded-lg border px-3 py-2 text-sm">
                  {ORG_MANAGED_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
                <Button variant="secondary">Save role</Button>
              </SettingsForm>
              <SettingsForm action={updateOrganizationMembershipAction} disableSaveUntilDirty={false} className="flex items-start lg:justify-end">
                <input type="hidden" name="user_id" value={member.userId} />
                <input type="hidden" name="is_active" value="false" />
                <Button variant="secondary" disabledWhenPristine={false}>Deactivate</Button>
              </SettingsForm>
            </div>
          )) : <div className="px-4 py-6 text-sm text-muted-foreground">No active users are assigned to this account yet.</div>}
        </div>

        <div className="rounded-lg border">
          <div className="border-b px-4 py-3 text-sm font-medium">Pending</div>
          {data.pendingInvites.length ? data.pendingInvites.map((invite) => (
            <div key={invite.id} className="grid gap-4 border-b px-4 py-4 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_180px]">
              <div>
                <div className="font-medium">{invite.fullName || invite.email}</div>
                <div className="text-sm text-muted-foreground">{invite.email}</div>
                <div className="mt-2 text-xs text-muted-foreground">{invite.role} · Sent {date(invite.sentAt)} · Expires {date(invite.expiresAt)}</div>
              </div>
              <div className="flex flex-wrap gap-2 lg:justify-end">
                <SettingsForm action={resendOrganizationInviteAction} disableSaveUntilDirty={false}>
                  <input type="hidden" name="invite_id" value={invite.id} />
                  <Button variant="secondary" disabledWhenPristine={false}>Resend</Button>
                </SettingsForm>
                <SettingsForm action={revokeOrganizationInviteAction} disableSaveUntilDirty={false}>
                  <input type="hidden" name="invite_id" value={invite.id} />
                  <Button variant="secondary" disabledWhenPristine={false}>Revoke</Button>
                </SettingsForm>
              </div>
            </div>
          )) : <div className="px-4 py-6 text-sm text-muted-foreground">No pending invites for this account.</div>}
        </div>

        <div className="rounded-lg border">
          <div className="border-b px-4 py-3 text-sm font-medium">Inactive</div>
          {data.inactiveUsers.length ? data.inactiveUsers.map((member) => (
            <div key={member.userId} className="grid gap-4 border-b px-4 py-4 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_160px]">
              <div>
                <div className="font-medium">{name(member)}</div>
                <div className="text-sm text-muted-foreground">{member.email || member.userId}</div>
                <div className="mt-2 text-xs text-muted-foreground">Role on deactivated membership: {member.role}. Last changed {date(member.updatedAt)}.</div>
              </div>
              <SettingsForm action={updateOrganizationMembershipAction} disableSaveUntilDirty={false} className="flex items-start lg:justify-end">
                <input type="hidden" name="user_id" value={member.userId} />
                <input type="hidden" name="is_active" value="true" />
                <Button variant="secondary" disabledWhenPristine={false}>Reactivate</Button>
              </SettingsForm>
            </div>
          )) : <div className="px-4 py-6 text-sm text-muted-foreground">No inactive memberships for this account.</div>}
        </div>
      </div>
    </div>
  );
}

function Permissions({ data, managementData }: { data: DealershipSettingsData; managementData: ManagementData | null }) {
  const matrix = buildRolePermissionMatrix(data.rolePermissions);
  const overrides = new Map(data.userPermissionOverrides.map((row) => [`${row.user_id}:${row.permission_key}`, row.allowed]));
  return (
    <div className="rounded-lg border bg-white p-6 shadow-sm">
      <Header title="Permissions" text="Defines what each role can do. User overrides take priority." />
      <div className="grid gap-4 lg:grid-cols-3">
        {ORG_MANAGED_ROLES.map((role) => (
          <SettingsForm key={role} action={updateRolePermissionsAction} className="rounded-lg border p-4">
            <input type="hidden" name="role" value={role} />
            {DEALERSHIP_PERMISSION_KEYS.filter((permission) => permission === "approve_overrides").map((permission) => (
              matrix.get(`${role}:${permission}`) ?? DEFAULT_ROLE_PERMISSION_PRESETS[role].includes(permission)
                ? <input key={permission} type="hidden" name={permission} value="on" />
                : null
            ))}
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="font-medium capitalize">{role}</div>
              <div className="text-xs text-muted-foreground">Role preset</div>
            </div>
            <div className="grid gap-2">
              {VISIBLE_PERMISSION_KEYS.map((permission) => (
                <label key={permission} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name={permission}
                    defaultChecked={matrix.get(`${role}:${permission}`) ?? DEFAULT_ROLE_PERMISSION_PRESETS[role].includes(permission)}
                  />
                  <span>{permissionLabel(permission)}</span>
                </label>
              ))}
            </div>
            <div className="mt-4"><Button>Save role</Button></div>
          </SettingsForm>
        ))}
      </div>
      <div className="mt-6 rounded-lg border p-4">
        <div className="font-medium">User overrides</div>
        <div className="mt-1 text-sm text-muted-foreground">Set exceptions for one user. Inherited means the role preset controls access.</div>
        <div className="mt-4 grid gap-4">
          {(managementData?.activeUsers ?? []).map((member) => {
            const selectedPermission = VISIBLE_PERMISSION_KEYS[0];
            const roleAllowed = matrix.get(`${member.role}:${selectedPermission}`) ?? DEFAULT_ROLE_PERMISSION_PRESETS[member.role].includes(selectedPermission);
            const overrideAllowed = overrides.get(`${member.userId}:${selectedPermission}`);
            const memberOverrides = data.userPermissionOverrides.filter(
              (row) => row.user_id === member.userId && row.permission_key !== "approve_overrides"
            );
            return (
            <SettingsForm key={member.userId} action={updateUserPermissionOverrideAction} className="grid gap-3 rounded-lg border bg-gray-50 p-3 md:grid-cols-[minmax(0,1fr)_240px_190px_110px]">
              <input type="hidden" name="user_id" value={member.userId} />
              <div className="text-sm">
                <div className="font-medium">{name(member)}</div>
                <div className="text-muted-foreground">Current role: {member.role}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {overrideAllowed === undefined
                    ? `Inherited ${roleAllowed ? "allowed" : "denied"} from role for ${permissionLabel(selectedPermission)}.`
                    : `Explicitly ${overrideAllowed ? "allowed" : "denied"} for ${permissionLabel(selectedPermission)}.`}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {memberOverrides.length
                    ? `Explicit overrides: ${memberOverrides.map((row) => `${permissionLabel(row.permission_key)} ${row.allowed ? "allowed" : "denied"}`).join(", ")}.`
                    : "No explicit overrides; all permissions inherit from role."}
                </div>
              </div>
              <select name="permission" className="rounded-lg border px-3 py-2 text-sm">
                {VISIBLE_PERMISSION_KEYS.map((permission) => <option key={permission} value={permission}>{permissionLabel(permission)}</option>)}
              </select>
              <select name="value" defaultValue={overrideAllowed === undefined ? "inherit" : String(overrideAllowed)} className="rounded-lg border px-3 py-2 text-sm">
                <option value="inherit">Inherit from role</option>
                <option value="true">Allow</option>
                <option value="false">Deny</option>
              </select>
              <Button variant="secondary">Save override</Button>
            </SettingsForm>
          )})}
          {(managementData?.activeUsers ?? []).length ? null : <div className="text-sm text-muted-foreground">No active users are available for overrides.</div>}
        </div>
      </div>
    </div>
  );
}

function Underwriting({ data }: { data: DealershipSettingsData }) {
  const lastUpdated = lastAuditDate(data, ["underwriting_tier_policy", "vehicle_term_policy"]);
  return (
    <div className="grid gap-6">
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <Header title="Underwriting" text="These rules control deal approvals and limits. Changes apply to new deals only." meta={`Last updated: ${date(lastUpdated)}`} />
        <EffectNote>Existing deals will not be recalculated until they are restructured.</EffectNote>
        <UnderwritingTierCards policies={data.tierPolicies} />
      </div>
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <Header title="Vehicle Term Policy" text="Term eligibility by vehicle age and mileage. Changes apply to new deals only." />
        <VehicleTermPolicyCards policies={data.vehicleTermPolicies} />
      </div>
    </div>
  );
}

function Workflow({ settings, data }: { settings: WorkflowSettings; data: DealershipSettingsData }) {
  const lastUpdated = lastAuditDate(data, ["organization_settings"]);
  return (
    <SettingsForm action={updateWorkflowSettingsAction} className="rounded-lg border bg-white p-6 shadow-sm">
      <Header title="Deal Workflow" text="Controls what steps are required before a deal can move forward." meta={`Last updated: ${date(lastUpdated)}`} />
      <EffectNote>Changes apply to new workflow checks and do not rewrite completed deal history.</EffectNote>
      <div className="grid gap-3 md:grid-cols-2">
        <Toggle name="step_enforcement_enabled" label="Enable step enforcement" text="Require deal steps to be completed in order." checked={settings.stepEnforcementEnabled} />
        <Toggle name="require_credit_bureau_before_submit" label="Require credit bureau PDF before submit" text="Blocks submit when the credit bureau document is missing." checked={settings.requireCreditBureauBeforeSubmit} />
        <Toggle name="require_customer_before_income" label="Require customer step before income" text="Stored for future enforcement; current flow remains permissive." checked={settings.requireCustomerBeforeIncome} />
        <Toggle name="require_underwriting_decision_before_vehicle" label="Require underwriting decision before vehicle" text="Requires a real underwriting decision before vehicle selection." checked={settings.requireUnderwritingDecisionBeforeVehicle} />
        <Toggle name="allow_admin_bypass" label="Allow admin bypass" text="Lets admins and platform dev bypass step gating." checked={settings.allowAdminBypass} />
        <Toggle name="lock_completed_steps_after_submit" label="Lock completed steps after submit" text="Prevents earlier deal steps from opening after submit." checked={settings.lockCompletedStepsAfterSubmit} />
        <Toggle name="require_manager_approval_to_reopen" label="Require manager approval to reopen submitted deals" text="Stored for a future reopen flow." checked={settings.requireManagerApprovalToReopenSubmittedDeals} />
      </div>
      <div className="mt-5"><Button /></div>
    </SettingsForm>
  );
}

function Products({ data }: { data: DealershipSettingsData }) {
  const config = data.trivianConfig;
  if (!config) return <div className="rounded-lg border bg-white p-6 shadow-sm"><Header title="Products & Pricing" text="No Trivian config row exists for this account yet." /></div>;
  return (
    <SettingsForm action={updateTrivianConfigAction} className="rounded-lg border bg-white p-6 shadow-sm">
      <input type="hidden" name="config_id" value={config.id} />
      <Header title="Products & Pricing" text="Defaults that feed future deal structures and restructures." meta={`Last updated: ${date(config.updated_at)}`} />
      <EffectNote>Existing deals keep their current structure until they are restructured.</EffectNote>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Default APR" name="apr" type="number" step="0.01" min="0" max="100" value={config.apr} helper="Percent, for example 28.99." />
        <Field label="PTI/payment cap" name="payment_cap_pct" type="number" step="0.01" min="0" max="1" value={config.payment_cap_pct} helper="Decimal, for example 0.22." />
        <Field label="VSC price" name="vsc_price" type="number" min="0" value={config.vsc_price} />
        <Field label="GAP price" name="gap_price" type="number" min="0" value={config.gap_price} />
        <Field label="Doc fee" name="doc_fee" type="number" min="0" value={config.doc_fee} />
        <Field label="Title/license default" name="title_license" type="number" min="0" value={config.title_license} />
        <Field label="Tax rate main" name="tax_rate_main" type="number" step="0.0001" min="0" max="1" value={config.tax_rate_main} helper="Decimal, for example 0.0625." />
        <Field label="Tax add base" name="tax_add_base" type="number" min="0" value={config.tax_add_base} />
        <Field label="Tax add rate" name="tax_add_rate" type="number" step="0.0001" min="0" max="1" value={config.tax_add_rate} helper="Decimal, for example 0.01." />
        <Field label="Pack fee" name="pack_fee" type="number" min="0" value={data.productPricing.packFee ?? ""} helper="Optional. Leave blank if not used." />
      </div>
      <div className="mt-5"><Button /></div>
    </SettingsForm>
  );
}

function Notifications({ data }: { data: DealershipSettingsData }) {
  const s = data.notifications;
  return (
    <SettingsForm action={updateNotificationsAction} className="rounded-lg border bg-white p-6 shadow-sm">
      <Header title="Notifications" text="Controls which account alerts Atlas sends through configured delivery channels." />
      <div className="grid gap-3 md:grid-cols-2">
        <Toggle name="deal_submitted_alerts" label="Deal submitted alerts" text="Controls existing funding-review alerts where wired." checked={s.dealSubmittedAlerts} />
        <Toggle name="override_request_alerts" label="Override request alerts" text="Controls existing override-request alerts where wired." checked={s.overrideRequestAlerts} />
        <Toggle name="credit_decision_alerts" label="Credit decision alerts" text="Stored for future credit decision routing." checked={s.creditDecisionAlerts} />
        <Toggle name="failed_document_parsing_alerts" label="Failed document parsing alerts" text="Stored for future parsing failure routing." checked={s.failedDocumentParsingAlerts} />
        <Toggle name="funding_ready_alerts" label="Funding-ready alerts" text="Controls funding-ready preferences where supported." checked={s.fundingReadyAlerts} />
      </div>
      <div className="mt-5"><Button /></div>
    </SettingsForm>
  );
}

function Integrations({ data, emailConfigured }: { data: DealershipSettingsData; emailConfigured: boolean }) {
  return (
    <SettingsForm action={updateIntegrationsAction} className="rounded-lg border bg-white p-6 shadow-sm">
      <Header title="Integrations" text="Connection status and account-level integration switches. Secrets are not shown here." />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border p-4"><div className="font-medium">Email delivery</div><div className="mt-1 text-sm text-muted-foreground">{emailConfigured ? "Configured" : "Not configured"}</div></div>
        <div className="rounded-lg border p-4"><div className="font-medium">Storage / document processing</div><div className="mt-1 text-sm text-muted-foreground">Supabase storage routes are present; secrets are not shown.</div></div>
        <Toggle name="inventory_import_enabled" label="DMS / inventory import" text="Stored account flag for future import scheduling." checked={data.integrations.inventoryImportEnabled} />
        <Toggle name="webhook_placeholders_enabled" label="Webhook/API placeholders" text="Stored account flag; no secret material is captured." checked={data.integrations.webhookPlaceholdersEnabled} />
      </div>
      <div className="mt-5"><Button /></div>
    </SettingsForm>
  );
}

function Audit({ data }: { data: DealershipSettingsData }) {
  return (
    <div className="rounded-lg border bg-white p-6 shadow-sm">
      <Header title="Audit / Compliance" text="Recent account-scoped settings changes." />
      <div className="rounded-lg border">
        {data.auditLogs.length ? data.auditLogs.map((log) => (
          <div key={log.id} className="border-b px-4 py-3 last:border-b-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-medium">{log.change_type ?? "Settings change"}</div>
              <div className="text-xs text-muted-foreground">{date(log.created_at)}</div>
            </div>
            <div className="mt-1 text-sm text-muted-foreground">Entity: {log.entity_type ?? "unknown"} · Changed by: {log.changed_by_user_id ?? "unknown"}</div>
          </div>
        )) : <div className="px-4 py-6 text-sm text-muted-foreground">No settings audit history yet. Future changes made here will be logged.</div>}
      </div>
    </div>
  );
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const selected = section(param(resolvedSearchParams, "section"));
  const supabase = await createClient();
  const authContext = await getAuthContext(supabase);
  const adminAccess = hasAdminAccess();
  const emailConfigured = isEmailDeliveryConfigured();
  const notice = param(resolvedSearchParams, "notice");
  const error = param(resolvedSearchParams, "error");
  const platformDev = authContext.realRole === "dev";
  const permissions =
    authContext.currentOrganizationId &&
    authContext.effectiveProfile?.id &&
    (authContext.effectiveOrganizationRole === "sales" ||
      authContext.effectiveOrganizationRole === "management" ||
      authContext.effectiveOrganizationRole === "admin")
      ? await getResolvedDealershipPermissions({
          organizationId: authContext.currentOrganizationId,
          userId: authContext.effectiveProfile.id,
          role: authContext.effectiveOrganizationRole,
        })
      : null;
  const canManageUsers = platformDev || !!permissions?.manage_users;
  const canViewAudit = platformDev || !!permissions?.view_audit_logs;
  const settingsData =
    authContext.currentOrganizationId && adminAccess
      ? await loadDealershipSettingsData(authContext.currentOrganizationId)
      : null;
  const managementData =
    canManageCurrentOrganization(authContext) &&
    canManageUsers &&
    authContext.currentOrganizationId &&
    adminAccess
      ? await loadOrganizationManagementData(authContext.currentOrganizationId)
      : null;
  const workflowSettings = adminAccess
    ? await getWorkflowSettings(supabase)
    : DEFAULT_WORKFLOW_SETTINGS;

  return (
    <div className="grid gap-6">
      {notice ? <Banner tone="notice">{notice}</Banner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
      {!authContext.currentOrganization ? <Banner tone="error">Select an account before editing dealership settings.</Banner> : null}
      {!adminAccess ? <Banner tone="error">Dealership settings require SUPABASE_SERVICE_ROLE_KEY for account-scoped administration.</Banner> : null}
      {canManageUsers && adminAccess && !emailConfigured ? <Banner tone="error">Invitations can be created, but email delivery is not configured yet.</Banner> : null}

      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <div className="text-xl font-semibold">Settings</div>
        <div className="mt-2 text-sm text-muted-foreground">
          Editing {authContext.currentOrganization?.name ?? "no selected account"}
          {authContext.currentOrganization?.slug ? ` (${authContext.currentOrganization.slug})` : ""}.
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="rounded-lg border bg-white p-3 shadow-sm">
          <nav className="grid gap-1">
            {SECTIONS.map(([key, label]) => (
              <Link
                key={key}
                href={`/settings?section=${key}`}
                className={`rounded-lg px-3 py-2 text-sm ${selected === key ? "bg-black text-white" : "hover:bg-gray-50"}`}
              >
                {label}
              </Link>
            ))}
          </nav>
        </aside>

        <section>
          {!settingsData ? (
            <div className="rounded-lg border bg-white p-6 text-sm text-muted-foreground shadow-sm">
              Settings data is unavailable until an account is selected and admin access is configured.
            </div>
          ) : selected === "general" ? (
            <General data={settingsData} />
          ) : selected === "users" ? (
            <Users data={managementData} />
          ) : selected === "permissions" ? (
            canManageUsers ? <Permissions data={settingsData} managementData={managementData} /> : <div className="rounded-lg border bg-white p-6 text-sm text-muted-foreground shadow-sm">You do not have permission to manage account permissions.</div>
          ) : selected === "underwriting" ? (
            <Underwriting data={settingsData} />
          ) : selected === "workflow" ? (
            <Workflow settings={workflowSettings} data={settingsData} />
          ) : selected === "products" ? (
            <Products data={settingsData} />
          ) : selected === "notifications" ? (
            <Notifications data={settingsData} />
          ) : selected === "integrations" ? (
            <Integrations data={settingsData} emailConfigured={emailConfigured} />
          ) : selected === "audit" ? (
            canViewAudit ? <Audit data={settingsData} /> : <div className="rounded-lg border bg-white p-6 text-sm text-muted-foreground shadow-sm">You do not have permission to view audit logs.</div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
