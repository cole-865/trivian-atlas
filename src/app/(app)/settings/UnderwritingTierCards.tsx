"use client";

import { useState, type ReactNode } from "react";
import type { UnderwritingTierPolicyRow } from "@/lib/settings/dealershipSettings";
import { updateTierPolicyAction } from "@/lib/settings/dealershipSettingsActions";
import { SaveButton, SettingsForm } from "./SettingsForm";

function percentInput(value: number | null | undefined) {
  if (value === null || value === undefined) return "";
  return Number((value * 100).toFixed(2));
}

function percentText(value: number | null | undefined) {
  if (value === null || value === undefined) return "Not set";
  return `${Number((value * 100).toFixed(2))}%`;
}

function moneyText(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
    style: "currency",
    currency: "USD",
  }).format(value ?? 0);
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

function TierGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-4">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</div>
    </div>
  );
}

function TierSummary({ policy }: { policy: UnderwritingTierPolicyRow }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-base font-semibold">Tier {policy.tier}</div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            policy.active ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"
          }`}
        >
          {policy.active ? "Active" : "Inactive"}
        </span>
      </div>
      <div className="mt-2 text-sm text-muted-foreground">
        {policy.max_term_months} mo / {percentText(policy.max_pti)} PTI / {percentText(policy.max_ltv)} LTV
      </div>
      <div className="mt-1 text-sm text-muted-foreground">
        Up to {moneyText(policy.max_amount_financed)} financed / {moneyText(policy.max_vehicle_price)} vehicle price
      </div>
    </div>
  );
}

export function UnderwritingTierCards({
  policies,
}: {
  policies: UnderwritingTierPolicyRow[];
}) {
  const [expandedTierId, setExpandedTierId] = useState<string | null>(null);

  if (!policies.length) {
    return <div className="text-sm text-muted-foreground">No underwriting tier policies are configured for this account.</div>;
  }

  return (
    <div className="mt-5 grid gap-4">
      {policies.map((policy) => {
        const expanded = expandedTierId === policy.id;

        return (
          <div key={policy.id} className="rounded-lg border bg-white shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4 p-5">
              <TierSummary policy={policy} />
              <button
                type="button"
                onClick={() => setExpandedTierId(expanded ? null : policy.id)}
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
                <SettingsForm action={updateTierPolicyAction} className="border-t p-5">
                  <input type="hidden" name="policy_id" value={policy.id} />
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <div className="font-medium">Edit Tier {policy.tier}</div>
                      <div className="mt-1 text-xs text-muted-foreground">Changes apply to this tier only.</div>
                    </div>
                    <label className="flex items-center gap-2 rounded-lg border bg-gray-50 px-3 py-2 text-sm">
                      <input type="checkbox" name="active" defaultChecked={policy.active} />
                      Active tier
                    </label>
                  </div>

                  <div className="grid gap-4">
                    <TierGroup title="Pricing">
                      <Field label="APR" name="apr" type="number" step="0.01" min="0" max="100" suffix="%" value={policy.apr ?? ""} helper="Annual rate for this tier." />
                    </TierGroup>
                    <TierGroup title="Loan Structure">
                      <Field label="Max term" name="max_term_months" type="number" min="1" max="60" suffix="mo" value={policy.max_term_months} helper="Longest allowed term." />
                      <Field label="PTI cap" name="max_pti_percent" type="number" step="0.01" min="0" max="100" suffix="%" value={percentInput(policy.max_pti)} helper="Maximum payment-to-income ratio." />
                      <Field label="LTV cap" name="max_ltv_percent" type="number" step="0.01" min="0" suffix="%" value={percentInput(policy.max_ltv)} helper="Maximum loan-to-value ratio." />
                    </TierGroup>
                    <TierGroup title="Deal Limits">
                      <Field label="Max amount financed" name="max_amount_financed" type="number" min="0" value={policy.max_amount_financed} helper="Maximum financed amount." />
                      <Field label="Vehicle price" name="max_vehicle_price" type="number" min="0" value={policy.max_vehicle_price} helper="Maximum vehicle price." />
                    </TierGroup>
                    <TierGroup title="Cash Down">
                      <Field label="Minimum cash down ($)" name="min_cash_down" type="number" min="0" value={policy.min_cash_down} helper="Minimum cash down." />
                      <Field label="Minimum down payment (%)" name="min_down_pct_percent" type="number" step="0.01" min="0" max="100" suffix="%" value={percentInput(policy.min_down_pct)} helper="Minimum required down payment." />
                    </TierGroup>
                  </div>

                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                    <div className="text-xs text-muted-foreground">Saving updates Tier {policy.tier} only.</div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setExpandedTierId(null)}
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
