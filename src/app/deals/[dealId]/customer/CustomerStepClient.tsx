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

export default function CustomerStepClient({ dealId }: { dealId: string }) {
  const router = useRouter();

  const [activeRole, setActiveRole] = useState<Role>("primary");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [navBusy, setNavBusy] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const [people, setPeople] = useState<Record<Role, PersonForm>>({
    primary: emptyForm(),
    co: emptyForm(),
  });

  const [docStatus, setDocStatus] = useState({
    credit_app: false,
    credit_bureau: false,
  });

  const activeForm = useMemo(() => people[activeRole], [people, activeRole]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const r = await fetch(`/api/deals/${dealId}/people`, { method: "GET" });
        const j = await r.json();

        if (!r.ok) throw new Error(j?.details || j?.error || "Failed to load people");

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
    setSaving(true);
    setError(null);

    try {
      const payload = {
        ...people[role],
        residence_months: people[role].residence_months === "" ? null : Number(people[role].residence_months),
      };

      const r = await fetch(`/api/deals/${dealId}/people/${role}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const j = await r.json();
      if (!r.ok) throw new Error(j?.details || j?.error || "Save failed");
    } catch (e: any) {
      setError(e?.message || "Save error");
      throw e;
    } finally {
      setSaving(false);
    }
  }

  const canNext = docStatus.credit_app && docStatus.credit_bureau;

  async function onPrev() {
    router.push("/deals");
  }

  async function onNext() {
    setError(null);

    if (!canNext) {
      setError("Upload Credit Application + Credit Bureau PDFs before continuing.");
      return;
    }

    // Optional: save the active role before moving on (prevents forgetting)
    setNavBusy(true);
    try {
      await saveRole(activeRole);
      router.push(`/deals/${dealId}/income`);
    } catch {
      // saveRole already sets error
    } finally {
      setNavBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Header + Nav */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h2 style={{ margin: 0 }}>Step 1: Customer</h2>

        {loading ? <span style={{ opacity: 0.7 }}>Loading…</span> : null}
        {saving ? <span style={{ opacity: 0.7 }}>Saving…</span> : null}
        {navBusy ? <span style={{ opacity: 0.7 }}>Continuing…</span> : null}
        {error ? <span style={{ color: "crimson" }}>{error}</span> : null}

        <div style={{ flex: 1 }} />

        <button
          type="button"
          onClick={onPrev}
          style={btnSecondary}
        >
          ← Previous
        </button>

        <button
          type="button"
          onClick={onNext}
          disabled={!canNext || loading || saving || navBusy}
          style={{
            ...btnPrimary,
            background: !canNext || loading || saving || navBusy ? "#999" : "#111",
            cursor: !canNext || loading || saving || navBusy ? "not-allowed" : "pointer",
          }}
          title={!canNext ? "Upload both PDFs to continue" : ""}
        >
          Next →
        </button>
      </div>

      {/* Data entry box */}
      <div style={card}>
        {/* Tabs + Save */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {(["primary", "co"] as Role[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setActiveRole(r)}
              style={tabBtn(activeRole === r)}
            >
              {roleLabel(r)}
            </button>
          ))}

          <div style={{ flex: 1 }} />

          <button
            type="button"
            onClick={() => saveRole(activeRole)}
            disabled={loading || saving}
            style={{
              ...btnPrimary,
              background: saving ? "#999" : "#111",
              cursor: loading || saving ? "not-allowed" : "pointer",
            }}
          >
            Save {roleLabel(activeRole)}
          </button>
        </div>

        {/* Form */}
        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="First Name" value={activeForm.first_name} onChange={(v) => updateField("first_name", v)} />
            <Field label="Last Name" value={activeForm.last_name} onChange={(v) => updateField("last_name", v)} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Phone" value={activeForm.phone} onChange={(v) => updateField("phone", v)} />
            <Field label="Email" value={activeForm.email} onChange={(v) => updateField("email", v)} />
          </div>

          <Field label="Address" value={activeForm.address_line1} onChange={(v) => updateField("address_line1", v)} />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 120px 120px", gap: 12 }}>
            <Field label="City" value={activeForm.city} onChange={(v) => updateField("city", v)} />
            <Field label="State" value={activeForm.state} onChange={(v) => updateField("state", v)} />
            <Field label="ZIP" value={activeForm.zip} onChange={(v) => updateField("zip", v)} />
            <Field
              label="Residence (months)"
              value={activeForm.residence_months}
              onChange={(v) => updateField("residence_months", clampDigitsOnly(v))}
            />
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 800 }}>Banking</div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
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

      {/* Documents under data entry box */}
      <div style={card}>
        <CustomerDocuments
          dealId={dealId}
          onStatus={(s: { credit_app: boolean; credit_bureau: boolean }) => {
            setDocStatus(s);
            if (s.credit_app && s.credit_bureau) setError(null);
          }}
        />
      </div>

      {/* Tiny status line */}
      <div style={{ fontSize: 12, opacity: 0.75 }}>
        Required to continue:{" "}
        <b>
          Credit App {docStatus.credit_app ? "✓" : "✗"} · Credit Bureau{" "}
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <div style={{ fontSize: 12, opacity: 0.8 }}>{label}</div>
      <input value={value} onChange={(e) => onChange(e.target.value)} style={input} />
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
    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 16, height: 16 }}
      />
      <span>{label}</span>
    </label>
  );
}

const card: React.CSSProperties = {
  border: "1px solid #e5e5e5",
  borderRadius: 14,
  padding: 14,
  display: "grid",
  gap: 12,
};

const input: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #ddd",
  outline: "none",
};

function tabBtn(active: boolean): React.CSSProperties {
  return {
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid #ddd",
    cursor: "pointer",
    background: active ? "#111" : "#fff",
    color: active ? "#fff" : "#111",
    fontWeight: 800,
  };
}

const btnPrimary: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 10,
  border: "1px solid #111",
  background: "#111",
  color: "#fff",
  fontWeight: 800,
};

const btnSecondary: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #ddd",
  background: "#fff",
  cursor: "pointer",
  fontWeight: 800,
};