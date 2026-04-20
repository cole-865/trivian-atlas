import Link from "next/link";
import { ChevronDown } from "lucide-react";
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
import { EmptyState, NoticeBanner, PageHeader, SectionCard } from "@/components/atlas/page";
import { Badge } from "@/components/ui/badge";
import { Button as UiButton } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

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

const VISIBLE_PERMISSION_KEYS = DEALERSHIP_PERMISSION_KEYS;

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
  return (
    <div className="mt-2 rounded-lg border border-border/70 bg-background/25 px-4 py-3 text-xs text-muted-foreground/82">
      {children}
    </div>
  );
}

function name(user: { fullName?: string | null; email?: string | null; userId?: string }) {
  return user.fullName || user.email || user.userId || "Unknown user";
}

function permissionLabel(permission: string) {
  return permission.replaceAll("_", " ");
}

function Banner({ tone, children }: { tone: "notice" | "error"; children: React.ReactNode }) {
  return <NoticeBanner tone={tone}>{children}</NoticeBanner>;
}

function Header({ title, text, meta }: { title: string; text: string; meta?: string }) {
  return (
    <div className="mb-5">
      <div className="text-lg font-semibold text-foreground">{title}</div>
      <div className="mt-1 text-sm text-muted-foreground/82">{text}</div>
      {meta ? (
        <div className="mt-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/72">
          {meta}
        </div>
      ) : null}
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
      <Label>{label}</Label>
      {suffix ? (
        <span className="flex overflow-hidden rounded-lg border border-input bg-input/45 shadow-sm focus-within:ring-2 focus-within:ring-ring">
          <Input
            name={name}
            type={type}
            required={required}
            min={min}
            max={max}
            step={step}
            defaultValue={value ?? ""}
            className="min-w-0 flex-1 rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          <span className="border-l border-border/80 bg-background/35 px-3 py-2 text-sm text-muted-foreground">
            {suffix}
          </span>
        </span>
      ) : (
        <Input
          name={name}
          type={type}
          required={required}
          min={min}
          max={max}
          step={step}
          defaultValue={value ?? ""}
        />
      )}
      {helper ? <span className="text-xs text-muted-foreground/78">{helper}</span> : null}
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
    <label className="flex items-start gap-3 rounded-xl border border-border/75 bg-background/20 px-4 py-3.5">
      <Checkbox type="checkbox" name={name} defaultChecked={checked} className="mt-0.5" />
      <span>
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block text-sm text-muted-foreground/82">{text}</span>
      </span>
    </label>
  );
}

function SelectField({
  label,
  name,
  value,
  children,
}: {
  label: string;
  name: string;
  value?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <Label>{label}</Label>
      <NativeSelect name={name} defaultValue={value}>
        {children}
      </NativeSelect>
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
    <SettingsForm action={updateGeneralSettingsAction} className="rounded-xl border border-border/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] p-6 shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
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
      <div className="mt-5 rounded-xl border border-border/70 bg-background/25 px-4 py-3 text-sm text-muted-foreground/82">Logo upload placeholder: storage path support exists in the model, but upload plumbing is intentionally not wired in this pass.</div>
      <div className="mt-5"><Button /></div>
    </SettingsForm>
  );
}

function InviteForm() {
  return (
    <SettingsForm action={createOrganizationInviteAction} disableSaveUntilDirty={false} className="grid gap-4 rounded-xl border border-border/75 bg-background/20 p-4 md:grid-cols-4">
      <Field label="Name" name="full_name" required />
      <Field label="Email" name="email" type="email" required />
      <SelectField label="Role" name="role" value="sales">
          {ORG_MANAGED_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
      </SelectField>
      <div className="flex items-end"><Button disabledWhenPristine={false}>Send invite</Button></div>
    </SettingsForm>
  );
}

function Users({ data }: { data: ManagementData | null }) {
  if (!data) {
    return (
      <SectionCard title="Users & Roles" description="User management is unavailable without account management permission.">
        <EmptyState
          title="User management unavailable"
          description="Atlas could not load organization members because your account does not have the required management access in the current organization."
        />
      </SectionCard>
    );
  }

  return (
    <div className="rounded-xl border border-border/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] p-6 shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
      <Header title="Users & Roles" text="Invite staff and manage active, pending, and inactive account access." />
      <InviteForm />
      <div className="mt-6 grid gap-5">
        <div className="overflow-hidden rounded-xl border border-border/75 bg-background/20">
          <div className="border-b border-border/70 px-4 py-3 text-sm font-medium text-foreground">Active</div>
          {data.activeUsers.length ? data.activeUsers.map((member) => (
            <div key={member.userId} className="grid gap-4 border-b px-4 py-4 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_180px_140px]">
              <div>
                <div className="font-medium text-foreground">{name(member)}</div>
                <div className="text-sm text-muted-foreground/82">{member.email || member.userId}</div>
                <div className="mt-2 text-xs text-muted-foreground/72">Last active: not available. Member since {date(member.createdAt)}.</div>
              </div>
              <SettingsForm action={updateOrganizationMembershipAction} className="grid content-start gap-2">
                <input type="hidden" name="user_id" value={member.userId} />
                <NativeSelect name="role" defaultValue={member.role}>
                  {ORG_MANAGED_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                </NativeSelect>
                <Button variant="secondary">Save role</Button>
              </SettingsForm>
              <SettingsForm action={updateOrganizationMembershipAction} disableSaveUntilDirty={false} className="flex items-start lg:justify-end">
                <input type="hidden" name="user_id" value={member.userId} />
                <input type="hidden" name="is_active" value="false" />
                <Button variant="secondary" disabledWhenPristine={false}>Deactivate</Button>
              </SettingsForm>
            </div>
          )) : <EmptyState className="m-4 min-h-32" title="No active users" description="No active users are assigned to this account yet." />}
        </div>

        <div className="overflow-hidden rounded-xl border border-border/75 bg-background/20">
          <div className="border-b border-border/70 px-4 py-3 text-sm font-medium text-foreground">Pending</div>
          {data.pendingInvites.length ? data.pendingInvites.map((invite) => (
            <div key={invite.id} className="grid gap-4 border-b px-4 py-4 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_180px]">
              <div>
                <div className="font-medium text-foreground">{invite.fullName || invite.email}</div>
                <div className="text-sm text-muted-foreground/82">{invite.email}</div>
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
          )) : <EmptyState className="m-4 min-h-32" title="No pending invites" description="No pending invites for this account." />}
        </div>

        <details className="group overflow-hidden rounded-xl border border-border/75 bg-background/20">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-foreground">
            <span>Inactive</span>
            <span className="flex items-center gap-2 text-xs uppercase tracking-[0.08em] text-muted-foreground/72">
              Hidden by default
              <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
            </span>
          </summary>
          {data.inactiveUsers.length ? data.inactiveUsers.map((member) => (
            <div key={member.userId} className="grid gap-4 border-b px-4 py-4 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_160px]">
              <div>
                <div className="font-medium text-foreground">{name(member)}</div>
                <div className="text-sm text-muted-foreground/82">{member.email || member.userId}</div>
                <div className="mt-2 text-xs text-muted-foreground/72">Role on deactivated membership: {member.role}. Last changed {date(member.updatedAt)}.</div>
              </div>
              <SettingsForm action={updateOrganizationMembershipAction} disableSaveUntilDirty={false} className="flex items-start lg:justify-end">
                <input type="hidden" name="user_id" value={member.userId} />
                <input type="hidden" name="is_active" value="true" />
                <Button variant="secondary" disabledWhenPristine={false}>Reactivate</Button>
              </SettingsForm>
            </div>
          )) : <EmptyState className="m-4 min-h-32" title="No inactive memberships" description="No inactive memberships for this account." />}
        </details>
      </div>
    </div>
  );
}

function Permissions({ data, managementData }: { data: DealershipSettingsData; managementData: ManagementData | null }) {
  const matrix = buildRolePermissionMatrix(data.rolePermissions);
  const overrides = new Map(data.userPermissionOverrides.map((row) => [`${row.user_id}:${row.permission_key}`, row.allowed]));
  return (
    <div className="rounded-xl border border-border/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] p-6 shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
      <Header title="Permissions" text="Defines what each role can do. User overrides take priority." />
      <div className="grid gap-4 lg:grid-cols-3">
        {ORG_MANAGED_ROLES.map((role) => (
          <SettingsForm key={role} action={updateRolePermissionsAction} className="rounded-xl border border-border/75 bg-background/20 p-4">
            <input type="hidden" name="role" value={role} />
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="font-medium capitalize text-foreground">{role}</div>
              <Badge variant="secondary">{role}</Badge>
            </div>
            <div className="grid gap-2">
              {VISIBLE_PERMISSION_KEYS.map((permission) => (
                <label key={permission} className="flex items-center gap-3 rounded-lg border border-border/70 bg-background/20 px-3 py-2 text-sm text-foreground">
                  <Checkbox
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
      <div className="mt-6 rounded-xl border border-border/75 bg-background/20 p-4">
        <div className="font-medium text-foreground">User overrides</div>
        <div className="mt-1 text-sm text-muted-foreground/82">Set exceptions for one user. Inherited means the role preset controls access.</div>
        <div className="mt-4 grid gap-4">
          {(managementData?.activeUsers ?? []).map((member) => {
            const selectedPermission = VISIBLE_PERMISSION_KEYS[0];
            const roleAllowed = matrix.get(`${member.role}:${selectedPermission}`) ?? DEFAULT_ROLE_PERMISSION_PRESETS[member.role].includes(selectedPermission);
            const overrideAllowed = overrides.get(`${member.userId}:${selectedPermission}`);
            const memberOverrides = data.userPermissionOverrides.filter(
              (row) => row.user_id === member.userId
            );
            return (
            <SettingsForm key={member.userId} action={updateUserPermissionOverrideAction} className="grid gap-3 rounded-xl border border-border/75 bg-background/20 p-3 md:grid-cols-[minmax(0,1fr)_240px_190px_110px]">
              <input type="hidden" name="user_id" value={member.userId} />
              <div className="text-sm">
                <div className="font-medium text-foreground">{name(member)}</div>
                <div className="text-muted-foreground/82">Current role: {member.role}</div>
                <div className="mt-1 text-xs text-muted-foreground/78">
                  {overrideAllowed === undefined
                    ? `Inherited ${roleAllowed ? "allowed" : "denied"} from role for ${permissionLabel(selectedPermission)}.`
                    : `Explicitly ${overrideAllowed ? "allowed" : "denied"} for ${permissionLabel(selectedPermission)}.`}
                </div>
                <div className="mt-1 text-xs text-muted-foreground/78">
                  {memberOverrides.length
                    ? `Explicit overrides: ${memberOverrides.map((row) => `${permissionLabel(row.permission_key)} ${row.allowed ? "allowed" : "denied"}`).join(", ")}.`
                    : "No explicit overrides; all permissions inherit from role."}
                </div>
              </div>
              <NativeSelect name="permission">
                {VISIBLE_PERMISSION_KEYS.map((permission) => <option key={permission} value={permission}>{permissionLabel(permission)}</option>)}
              </NativeSelect>
              <NativeSelect name="value" defaultValue={overrideAllowed === undefined ? "inherit" : String(overrideAllowed)}>
                <option value="inherit">Inherit from role</option>
                <option value="true">Allow</option>
                <option value="false">Deny</option>
              </NativeSelect>
              <Button variant="secondary">Save override</Button>
            </SettingsForm>
          )})}
          {(managementData?.activeUsers ?? []).length ? null : <EmptyState className="min-h-32" title="No active users available" description="Atlas cannot apply user-specific permission overrides until at least one active organization member exists." />}
        </div>
      </div>
    </div>
  );
}

function Underwriting({ data }: { data: DealershipSettingsData }) {
  const lastUpdated = lastAuditDate(data, ["underwriting_tier_policy", "vehicle_term_policy"]);
  return (
    <div className="grid gap-6">
      <div className="rounded-xl border border-border/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] p-6 shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
        <Header title="Underwriting" text="These rules control deal approvals and limits. Changes apply to new deals only." meta={`Last updated: ${date(lastUpdated)}`} />
        <EffectNote>Existing deals will not be recalculated until they are restructured.</EffectNote>
        <UnderwritingTierCards policies={data.tierPolicies} />
      </div>
      <div className="rounded-xl border border-border/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] p-6 shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
        <Header title="Vehicle Term Policy" text="Term eligibility by vehicle age and mileage. Changes apply to new deals only." />
        <VehicleTermPolicyCards policies={data.vehicleTermPolicies} />
      </div>
    </div>
  );
}

function Workflow({ settings, data }: { settings: WorkflowSettings; data: DealershipSettingsData }) {
  const lastUpdated = lastAuditDate(data, ["organization_settings"]);
  return (
    <SettingsForm action={updateWorkflowSettingsAction} className="rounded-xl border border-border/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] p-6 shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
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
  if (!config) {
    return (
      <SectionCard title="Products & Pricing" description="No pricing config row exists for this account yet.">
        <EmptyState
          title="No pricing config found"
          description="Atlas could not find an organization-scoped pricing config row for the current account."
        />
      </SectionCard>
    );
  }
  return (
    <SettingsForm action={updateTrivianConfigAction} className="rounded-xl border border-border/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] p-6 shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
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
    <SettingsForm action={updateNotificationsAction} className="rounded-xl border border-border/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] p-6 shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
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
    <SettingsForm action={updateIntegrationsAction} className="rounded-xl border border-border/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] p-6 shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
      <Header title="Integrations" text="Connection status and account-level integration switches. Secrets are not shown here." />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border/75 bg-background/20 p-4"><div className="font-medium text-foreground">Email delivery</div><div className="mt-1 text-sm text-muted-foreground/82">{emailConfigured ? "Configured" : "Not configured"}</div></div>
        <div className="rounded-xl border border-border/75 bg-background/20 p-4"><div className="font-medium text-foreground">Storage / document processing</div><div className="mt-1 text-sm text-muted-foreground/82">Supabase storage routes are present; secrets are not shown.</div></div>
        <Toggle name="inventory_import_enabled" label="DMS / inventory import" text="Stored account flag for future import scheduling." checked={data.integrations.inventoryImportEnabled} />
        <Toggle name="webhook_placeholders_enabled" label="Webhook/API placeholders" text="Stored account flag; no secret material is captured." checked={data.integrations.webhookPlaceholdersEnabled} />
      </div>
      <div className="mt-5"><Button /></div>
    </SettingsForm>
  );
}

function Audit({ data }: { data: DealershipSettingsData }) {
  return (
    <div className="rounded-xl border border-border/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] p-6 shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
      <Header title="Audit / Compliance" text="Recent account-scoped settings changes." />
      <div className="overflow-hidden rounded-xl border border-border/75 bg-background/20">
        {data.auditLogs.length ? data.auditLogs.map((log) => (
          <div key={log.id} className="border-b border-border/70 px-4 py-3 last:border-b-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-medium text-foreground">{log.change_type ?? "Settings change"}</div>
              <div className="text-xs text-muted-foreground/72">{date(log.created_at)}</div>
            </div>
            <div className="mt-1 text-sm text-muted-foreground/82">Entity: {log.entity_type ?? "unknown"} · Changed by: {log.changed_by_user_id ?? "unknown"}</div>
          </div>
        )) : <EmptyState className="m-4 min-h-32" title="No settings audit history" description="Future changes made here will be logged." />}
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
  const platformDev = authContext.realRole === "dev" && !authContext.isImpersonating;
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

      <PageHeader
        eyebrow="Administration"
        title="Settings"
        description={`Editing ${authContext.currentOrganization?.name ?? "no selected account"}${authContext.currentOrganization?.slug ? ` (${authContext.currentOrganization.slug})` : ""}.`}
        actions={
          selected === "users" && canManageUsers ? (
            <Badge variant="default">User management</Badge>
          ) : selected === "audit" && canViewAudit ? (
            <Badge variant="secondary">Audit visible</Badge>
          ) : (
            <Badge variant="secondary">Organization scoped</Badge>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="rounded-xl border border-border/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] p-3 shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
          <nav className="grid gap-1">
            {SECTIONS.map(([key, label]) => (
              <UiButton
                key={key}
                asChild
                variant={selected === key ? "default" : "ghost"}
                className="justify-start"
              >
                <Link href={`/settings?section=${key}`}>{label}</Link>
              </UiButton>
            ))}
          </nav>
        </aside>

        <section>
          {!settingsData ? (
            <SectionCard title="Settings unavailable" description="Settings data is unavailable until an account is selected and admin access is configured.">
              <EmptyState
                title="No settings data available"
                description="Atlas needs a selected organization and configured admin access before this page can render account-scoped settings."
              />
            </SectionCard>
          ) : selected === "general" ? (
            <General data={settingsData} />
          ) : selected === "users" ? (
            <Users data={managementData} />
          ) : selected === "permissions" ? (
            canManageUsers ? <Permissions data={settingsData} managementData={managementData} /> : <SectionCard title="Permissions" description="You do not have permission to manage account permissions."><EmptyState title="Permission management unavailable" description="Your current organization role does not allow updates to role permissions or user overrides." /></SectionCard>
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
            canViewAudit ? <Audit data={settingsData} /> : <SectionCard title="Audit / Compliance" description="You do not have permission to view audit logs."><EmptyState title="Audit log unavailable" description="Your current role cannot view account-scoped audit history for the selected organization." /></SectionCard>
          ) : null}
        </section>
      </div>
    </div>
  );
}
