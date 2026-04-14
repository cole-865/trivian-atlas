"use client";

import { useState, type ReactNode } from "react";
import type { VehicleTermPolicyRow } from "@/lib/settings/dealershipSettings";
import { updateVehicleTermPolicyAction } from "@/lib/settings/dealershipSettingsActions";
import { SaveButton, SettingsForm } from "./SettingsForm";
import { EmptyState } from "@/components/atlas/page";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

function mileageValue(value: number | null | undefined) {
  if (value === null || value === undefined) return null;
  if (value >= 1000) {
    const wholeThousands = value / 1000;
    const formattedThousands = Number.isInteger(wholeThousands)
      ? String(wholeThousands)
      : wholeThousands.toFixed(1).replace(/\.0$/, "");
    return `${formattedThousands}k`;
  }

  return new Intl.NumberFormat("en-US").format(value);
}

function mileageRange(min: number | null | undefined, max: number | null | undefined) {
  const minText = mileageValue(min);
  const maxText = mileageValue(max);

  if (minText && maxText) return `${minText}-${maxText} miles`;
  if (minText) return `${minText}+ miles`;
  if (maxText) return `Up to ${maxText} miles`;
  return "Any mileage";
}

function ageRange(min: number | null | undefined, max: number | null | undefined) {
  if (min !== null && min !== undefined && max !== null && max !== undefined) {
    return `${min}-${max} years old`;
  }

  if (min !== null && min !== undefined) return `${min}+ years old`;
  if (max !== null && max !== undefined) return `Up to ${max} years old`;
  return "Any vehicle age";
}

function Field({
  label,
  name,
  value,
  type = "text",
  helper,
  min,
  max,
  step,
  suffix,
  multiline = false,
}: {
  label: string;
  name: string;
  value?: string | number | null;
  type?: string;
  helper?: string;
  min?: string | number;
  max?: string | number;
  step?: string | number;
  suffix?: string;
  multiline?: boolean;
}) {
  return (
    <label className="grid gap-2">
      <Label>{label}</Label>
      {multiline ? (
        <Textarea name={name} defaultValue={String(value ?? "")} className="min-h-24" />
      ) : suffix ? (
        <span className="flex overflow-hidden rounded-lg border border-input bg-input/45 shadow-sm focus-within:ring-2 focus-within:ring-ring">
          <Input
            name={name}
            type={type}
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

function PolicyGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border/75 bg-background/20 p-4">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground/72">
        {title}
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</div>
    </div>
  );
}

function PolicySummary({ policy }: { policy: VehicleTermPolicyRow }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-base font-semibold text-foreground">Policy {policy.sort_order}</div>
        <Badge variant={policy.active ? "success" : "secondary"}>
          {policy.active ? "Active" : "Inactive"}
        </Badge>
      </div>
      <div className="mt-2 text-sm text-muted-foreground/82">
        {mileageRange(policy.min_mileage, policy.max_mileage)} / {policy.max_term_months} months max
      </div>
      <div className="mt-1 text-sm text-muted-foreground/82">
        {ageRange(policy.min_vehicle_age, policy.max_vehicle_age)}
      </div>
      {policy.notes ? (
        <div className="mt-1 truncate text-xs text-muted-foreground/72">{policy.notes}</div>
      ) : null}
    </div>
  );
}

export function VehicleTermPolicyCards({
  policies,
}: {
  policies: VehicleTermPolicyRow[];
}) {
  const [expandedPolicyId, setExpandedPolicyId] = useState<string | null>(null);

  if (!policies.length) {
    return (
      <EmptyState
        className="mt-5 min-h-32"
        title="No vehicle term policies"
        description="No vehicle term policies are configured for this account."
      />
    );
  }

  return (
    <div className="mt-5 grid gap-4">
      {policies.map((policy) => {
        const expanded = expandedPolicyId === policy.id;

        return (
          <div key={policy.id} className="rounded-xl border border-border/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] shadow-[0_16px_36px_rgba(0,0,0,0.18)]">
            <div className="flex flex-wrap items-start justify-between gap-4 p-5">
              <PolicySummary policy={policy} />
              <button
                type="button"
                onClick={() => setExpandedPolicyId(expanded ? null : policy.id)}
                aria-expanded={expanded}
                className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                {expanded ? "Collapse" : "Edit"}
              </button>
            </div>

            <div
              className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
              }`}
            >
              <div className="overflow-hidden">
                <SettingsForm action={updateVehicleTermPolicyAction} className="border-t border-border/70 p-5">
                  <input type="hidden" name="policy_id" value={policy.id} />
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <div className="font-medium text-foreground">Edit Policy {policy.sort_order}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Changes apply to this policy only.
                      </div>
                    </div>
                    <label className="flex items-center gap-2 rounded-lg border border-border/75 bg-background/20 px-3 py-2 text-sm text-foreground">
                      <Checkbox type="checkbox" name="active" defaultChecked={policy.active} />
                      Active policy
                    </label>
                  </div>

                  <div className="grid gap-4">
                    <PolicyGroup title="Term">
                      <Field
                        label="Max term"
                        name="max_term_months"
                        type="number"
                        min="1"
                        max="60"
                        suffix="mo"
                        value={policy.max_term_months}
                      />
                    </PolicyGroup>
                    <PolicyGroup title="Mileage Range">
                      <Field
                        label="Min mileage"
                        name="min_mileage"
                        type="number"
                        min="0"
                        value={policy.min_mileage ?? ""}
                        helper="Blank means no minimum."
                      />
                      <Field
                        label="Max mileage"
                        name="max_mileage"
                        type="number"
                        min="0"
                        value={policy.max_mileage ?? ""}
                        helper="Blank means no maximum."
                      />
                    </PolicyGroup>
                    <PolicyGroup title="Vehicle Age">
                      <Field
                        label="Min age"
                        name="min_vehicle_age"
                        type="number"
                        min="0"
                        suffix="yrs"
                        value={policy.min_vehicle_age ?? ""}
                        helper="Blank means no minimum."
                      />
                      <Field
                        label="Max age"
                        name="max_vehicle_age"
                        type="number"
                        min="0"
                        suffix="yrs"
                        value={policy.max_vehicle_age ?? ""}
                        helper="Blank means no maximum."
                      />
                    </PolicyGroup>
                    <PolicyGroup title="Notes">
                      <Field label="Notes" name="notes" value={policy.notes ?? ""} multiline />
                    </PolicyGroup>
                  </div>

                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4">
                    <div className="text-xs text-muted-foreground/72">
                      Saving updates policy {policy.sort_order} only.
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setExpandedPolicyId(null)}
                        className="rounded-lg border border-border bg-secondary px-4 py-2 text-sm text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                      >
                        Cancel
                      </button>
                      <SaveButton>Save changes</SaveButton>
                    </div>
                  </div>
                </SettingsForm>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
