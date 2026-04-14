"use client";

import { useState, type ReactNode } from "react";
import type { VehicleTermPolicyRow } from "@/lib/settings/dealershipSettings";
import { updateVehicleTermPolicyAction } from "@/lib/settings/dealershipSettingsActions";
import { SaveButton, SettingsForm } from "./SettingsForm";

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
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium">{label}</span>
      {suffix ? (
        <span className="flex overflow-hidden rounded-lg border bg-white focus-within:ring-1 focus-within:ring-black">
          <input
            name={name}
            type={type}
            min={min}
            max={max}
            step={step}
            defaultValue={value ?? ""}
            className="min-w-0 flex-1 border-0 px-3 py-2 text-sm outline-none"
          />
          <span className="border-l bg-gray-50 px-3 py-2 text-sm text-muted-foreground">
            {suffix}
          </span>
        </span>
      ) : (
        <input
          name={name}
          type={type}
          min={min}
          max={max}
          step={step}
          defaultValue={value ?? ""}
          className="rounded-lg border px-3 py-2 text-sm"
        />
      )}
      {helper ? <span className="text-xs text-muted-foreground">{helper}</span> : null}
    </label>
  );
}

function PolicyGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-4">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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
        <div className="text-base font-semibold">Policy {policy.sort_order}</div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            policy.active ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"
          }`}
        >
          {policy.active ? "Active" : "Inactive"}
        </span>
      </div>
      <div className="mt-2 text-sm text-muted-foreground">
        {mileageRange(policy.min_mileage, policy.max_mileage)} / {policy.max_term_months} months max
      </div>
      <div className="mt-1 text-sm text-muted-foreground">
        {ageRange(policy.min_vehicle_age, policy.max_vehicle_age)}
      </div>
      {policy.notes ? (
        <div className="mt-1 truncate text-xs text-muted-foreground">{policy.notes}</div>
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
      <div className="text-sm text-muted-foreground">
        No vehicle term policies are configured for this account.
      </div>
    );
  }

  return (
    <div className="mt-5 grid gap-4">
      {policies.map((policy) => {
        const expanded = expandedPolicyId === policy.id;

        return (
          <div key={policy.id} className="rounded-lg border bg-white shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4 p-5">
              <PolicySummary policy={policy} />
              <button
                type="button"
                onClick={() => setExpandedPolicyId(expanded ? null : policy.id)}
                aria-expanded={expanded}
                className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
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
                <SettingsForm action={updateVehicleTermPolicyAction} className="border-t p-5">
                  <input type="hidden" name="policy_id" value={policy.id} />
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <div className="font-medium">Edit Policy {policy.sort_order}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Changes apply to this policy only.
                      </div>
                    </div>
                    <label className="flex items-center gap-2 rounded-lg border bg-gray-50 px-3 py-2 text-sm">
                      <input type="checkbox" name="active" defaultChecked={policy.active} />
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
                      <Field label="Notes" name="notes" value={policy.notes ?? ""} />
                    </PolicyGroup>
                  </div>

                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                    <div className="text-xs text-muted-foreground">
                      Saving updates policy {policy.sort_order} only.
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setExpandedPolicyId(null)}
                        className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-50"
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
