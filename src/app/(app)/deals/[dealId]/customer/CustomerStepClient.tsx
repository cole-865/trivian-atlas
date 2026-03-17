"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import CustomerDocuments from "./CustomerDocuments";

type Role = "primary" | "co";

type PersonForm = {
  first_name: string;
  last_name: string;
  phone: string;
  email: string;

  address_line1: string;
  city: string;
  state: string;
  zip: string;

  residence_months: string; // keep as string for input

  banking_checking: boolean;
  banking_savings: boolean;
  banking_prepaid: boolean;
};

const emptyForm = (): PersonForm => ({
  first_name: "",
  last_name: "",
  phone: "",
  email: "",
  address_line1: "",
  city: "",
  state: "",
  zip: "",
  residence_months: "",
  banking_checking: false,
  banking_savings: false,
  banking_prepaid: false,
});

function roleLabel(role: Role) {
  return role === "primary" ? "Driver" : "Co-app";
}

function clampDigitsOnly(s: string) {
  return (s ?? "").replace(/[^\d]/g, "");
}

function hasAnyData(p: PersonForm) {
  return Boolean(
    p.first_name.trim() ||
    p.last_name.trim() ||
    p.phone.trim() ||
    p.email.trim() ||
    p.address_line1.trim() ||
    p.city.trim() ||
    p.state.trim() ||
    p.zip.trim() ||
    p.residence_months.trim() ||
    p.banking_checking ||
    p.banking_savings ||
    p.banking_prepaid
  );
}

function primaryNameOk(p: PersonForm) {
  return p.first_name.trim().length > 0 && p.last_name.trim().length > 0;
}

function formatSaveError(j: any, fallback: string) {
  return (
    j?.details ||
    j?.error ||
    j?.message ||
    (typeof j === "string" ? j : null) ||
    fallback
  );
}

export default function CustomerStepClient({ dealId }: { dealId: string }) {
  const router = useRouter();

  const [activeRole, setActiveRole] = useState<Role>("primary");

  const [loading, setLoading] = useState(true);
  const [savingRole, setSavingRole] = useState<Role | null>(null);
  const [navBusy, setNavBusy] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const [people, setPeople] = useState<Record<Role, PersonForm>>({
    primary: emptyForm(),
    co: emptyForm(),
  });

  const [docStatus, setDocStatus] = useState({
    credit_bureau: false,
  });

  const activeForm = useMemo(() => people[activeRole], [people, activeRole]);

  const primaryOk = useMemo(() => primaryNameOk(people.primary), [people.primary]);
  const docsOk = docStatus.credit_bureau;
  const canNext = primaryOk && docsOk && !loading && !navBusy && !savingRole;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const r = await fetch(`/api/deals/${dealId}/people`, { method: "GET" });
        const j = await r.json().catch(() => ({}));

        if (!r.ok) throw new Error(formatSaveError(j, "Failed to load people"));

        const next: Record<Role, PersonForm> = {
          primary: emptyForm(),
          co: emptyForm(),
        };

        for (const p of j.people ?? []) {
          const role: Role | null =
            p.role === "primary" ? "primary" : p.role === "co" ? "co" : null;
          if (!role) continue;

          next[role] = {
            first_name: p.first_name ?? "",
            last_name: p.last_name ?? "",
            phone: p.phone ?? "",
            email: p.email ?? "",

            address_line1: p.address_line1 ?? "",
            city: p.city ?? "",
            state: p.state ?? "",
            zip: p.zip ?? "",

            residence_months: p.residence_months?.toString?.() ?? "",

            banking_checking: !!p.banking_checking,
            banking_savings: !!p.banking_savings,
            banking_prepaid: !!p.banking_prepaid,
          };
        }

        if (!cancelled) setPeople(next);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Load error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [dealId]);

  function updateField<K extends keyof PersonForm>(key: K, value: PersonForm[K]) {
    setPeople((prev) => ({
      ...prev,
      [activeRole]: {
        ...prev[activeRole],
        [key]: value,
      },
    }));
  }

  async function saveRole(role: Role) {
    // ✅ Don’t create/update empty rows at all
    if (!hasAnyData(people[role])) return;

    // ✅ Hard rule: primary must have first + last name
    if (role === "primary" && !primaryNameOk(people.primary)) {
      const msg = "Driver first + last name are required.";
      setError(msg);
      throw new Error(msg);
    }

    setSavingRole(role);
    setError(null);

    try {
      const payload = {
        ...people[role],
        residence_months:
          people[role].residence_months === ""
            ? null
            : Number(people[role].residence_months),
      };

      const r = await fetch(`/api/deals/${dealId}/people/${role}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(formatSaveError(j, "Save failed"));
    } catch (e: any) {
      setError(e?.message || "Save error");
      throw e;
    } finally {
      setSavingRole(null);
    }
  }

  function nextBlockerMessage() {
    if (!primaryOk) return "Enter Driver first + last name to continue.";
    if (!docsOk) return "Upload Credit Bureau PDFs before continuing.";
    return null;
  }

  async function onPrev() {
    router.push("/deals");
  }

  async function onNext() {
    setError(null);

    const blocker = nextBlockerMessage();
    if (blocker) {
      setError(blocker);
      return;
    }

    setNavBusy(true);
    try {
      // Save primary (required)
      await saveRole("primary");

      // Save co-app only if they entered anything
      await saveRole("co");

      router.push(`/deals/${dealId}/income`);
    } catch {
      // saveRole already set error
    } finally {
      setNavBusy(false);
    }
  }

  const headerStatus = (() => {
    if (loading) return "Loading…";
    if (savingRole) return `Saving ${roleLabel(savingRole)}…`;
    if (navBusy) return "Continuing…";
    return null;
  })();

  return (
    <div className="grid gap-4">
      {/* Header + Nav */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[220px]">
          <h2 className="m-0 text-lg font-semibold">Step 1: Customer</h2>
          <div className="text-xs text-muted-foreground">
            Required: Driver name + Credit Bureau PDF.
          </div>
        </div>

        {headerStatus ? (
          <span className="text-xs text-muted-foreground">{headerStatus}</span>
        ) : null}

        {error ? (
          <span className="text-sm text-red-600">{error}</span>
        ) : null}

        <div className="flex-1" />

        <button
          type="button"
          onClick={onPrev}
          className="rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-gray-50"
        >
          ← Previous
        </button>

        <button
          type="button"
          onClick={onNext}
          disabled={!canNext}
          className={[
            "rounded-xl px-3 py-2 text-sm font-semibold text-white",
            canNext ? "bg-black hover:opacity-90" : "bg-gray-400 cursor-not-allowed",
          ].join(" ")}
          title={!canNext ? nextBlockerMessage() ?? "" : ""}
        >
          Next →
        </button>
      </div>

      {/* Data entry box */}
      <div className="rounded-2xl border bg-white p-4 shadow-sm grid gap-3">
        {/* Tabs + Save */}
        <div className="flex flex-wrap gap-2 items-center">
          {(["primary", "co"] as Role[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setActiveRole(r)}
              className={[
                "rounded-xl border px-3 py-2 text-sm font-semibold",
                activeRole === r
                  ? "bg-black text-white border-black"
                  : "bg-white hover:bg-gray-50",
              ].join(" ")}
            >
              {roleLabel(r)}
            </button>
          ))}

          <div className="flex-1" />

          <button
            type="button"
            onClick={() => saveRole(activeRole)}
            disabled={loading || !!savingRole || navBusy}
            className={[
              "rounded-xl px-3 py-2 text-sm font-semibold text-white",
              loading || !!savingRole || navBusy
                ? "bg-gray-400 cursor-not-allowed"
                : "bg-black hover:opacity-90",
            ].join(" ")}
            title={
              activeRole === "primary" && !primaryOk
                ? "Driver first + last name required to save"
                : hasAnyData(activeForm)
                  ? ""
                  : "Nothing to save"
            }
          >
            Save {roleLabel(activeRole)}
          </button>
        </div>

        {/* Form */}
        <div className="grid gap-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field
              label="First Name"
              value={activeForm.first_name}
              onChange={(v) => updateField("first_name", v)}
              required={activeRole === "primary"}
              invalid={activeRole === "primary" && !activeForm.first_name.trim()}
            />
            <Field
              label="Last Name"
              value={activeForm.last_name}
              onChange={(v) => updateField("last_name", v)}
              required={activeRole === "primary"}
              invalid={activeRole === "primary" && !activeForm.last_name.trim()}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field
              label="Phone"
              value={activeForm.phone}
              onChange={(v) => updateField("phone", v)}
            />
            <Field
              label="Email"
              value={activeForm.email}
              onChange={(v) => updateField("email", v)}
            />
          </div>

          <Field
            label="Address"
            value={activeForm.address_line1}
            onChange={(v) => updateField("address_line1", v)}
          />

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Field
              label="City"
              value={activeForm.city}
              onChange={(v) => updateField("city", v)}
            />
            <Field
              label="State"
              value={activeForm.state}
              onChange={(v) => updateField("state", v)}
            />
            <Field
              label="ZIP"
              value={activeForm.zip}
              onChange={(v) => updateField("zip", v)}
            />
            <Field
              label="Residence (months)"
              value={activeForm.residence_months}
              onChange={(v) => updateField("residence_months", clampDigitsOnly(v))}
            />
          </div>

          <div className="grid gap-2">
            <div className="font-semibold">Banking</div>
            <div className="flex gap-4 flex-wrap">
              <Checkbox
                label="Checking"
                checked={activeForm.banking_checking}
                onChange={(v) => updateField("banking_checking", v)}
              />
              <Checkbox
                label="Savings"
                checked={activeForm.banking_savings}
                onChange={(v) => updateField("banking_savings", v)}
              />
              <Checkbox
                label="Prepaid"
                checked={activeForm.banking_prepaid}
                onChange={(v) => updateField("banking_prepaid", v)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Documents */}
      <div className="rounded-2xl border bg-white p-4 shadow-sm grid gap-3">
        <CustomerDocuments
          dealId={dealId}
          onStatus={(s: { credit_app: boolean; credit_bureau: boolean }) => {
            setDocStatus({
              credit_bureau: s.credit_bureau,
            });

            // Clear doc-related error if bureau is uploaded
            if (s.credit_bureau && error?.toLowerCase().includes("upload")) {
              setError(null);
            }
          }}
        />
      </div>

      {/* Tiny status line */}
      <div className="text-xs text-muted-foreground">
        Required to continue:{" "}
        <b>
          Driver name {primaryOk ? "✓" : "✗"} · Credit Bureau{" "}
          {docStatus.credit_bureau ? "✓" : "✗"}
        </b>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  invalid?: boolean;
}) {
  return (
    <label className="grid gap-1">
      <div className="text-xs text-muted-foreground">
        {label}{" "}
        {required ? <span className="text-red-600 font-semibold">*</span> : null}
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={[
          "rounded-xl border px-3 py-2 text-sm outline-none",
          invalid ? "border-red-400" : "border-gray-200",
        ].join(" ")}
      />
    </label>
  );
}

function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4"
      />
      <span>{label}</span>
    </label>
  );
}