"use client";

import { useState, type ReactNode } from "react";
import type { UnderwritingTierPolicyRow } from "@/lib/settings/dealershipSettings";
import { updateTierPolicyAction } from "@/lib/settings/dealershipSettingsActions";
import { SaveButton, SettingsForm } from "./SettingsForm";
import { EmptyState } from "@/components/atlas/page";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
      <Label>{label}</Label>
      {suffix ? (
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
          className="rounded-lg border px-3 py-2 text-sm"
        />
      )}
      {helper ? <span className="text-xs text-muted-foreground/78">{helper}</span> : null}
    </label>
  );
}

function TierGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border/75 bg-background/20 p-4">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground/72">
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
        <div className="text-base font-semibold text-foreground">Tier {policy.tier}</div>
        <Badge variant={policy.active ? "success" : "secondary"}>
          {policy.active ? "Active" : "Inactive"}
        </Badge>
      </div>
      <div className="mt-2 text-sm text-muted-foreground/82">
        {policy.max_term_months} mo / {percentText(policy.max_pti)} PTI / {percentText(policy.max_ltv)} LTV
      </div>
      <div className="mt-1 text-sm text-muted-foreground/82">
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
    return (
      <EmptyState
        className="mt-5 min-h-32"
        title="No underwriting tiers"
        description="No underwriting tier policies are configured for this account."
      />
    );
  }

  return (
    <div className="mt-5 grid gap-4">
      {policies.map((policy) => {
        const expanded = expandedTierId === policy.id;

        return (
          <div key={policy.id} className="rounded-xl border border-border/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] shadow-[0_16px_36px_rgba(0,0,0,0.18)]">
            <div className="flex flex-wrap items-start justify-between gap-4 p-5">
              <TierSummary policy={policy} />
              <button
                type="button"
                onClick={() => setExpandedTierId(expanded ? null : policy.id)}
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
                <SettingsForm action={updateTierPolicyAction} className="border-t border-border/70 p-5">
                  <input type="hidden" name="policy_id" value={policy.id} />
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <div className="font-medium text-foreground">Edit Tier {policy.tier}</div>
                      <div className="mt-1 text-xs text-muted-foreground/72">Changes apply to this tier only.</div>
                    </div>
                    <label className="flex items-center gap-2 rounded-lg border border-border/75 bg-background/20 px-3 py-2 text-sm text-foreground">
                      <Checkbox type="checkbox" name="active" defaultChecked={policy.active} />
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

                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4">
                    <div className="text-xs text-muted-foreground/72">Saving updates Tier {policy.tier} only.</div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setExpandedTierId(null)}
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
