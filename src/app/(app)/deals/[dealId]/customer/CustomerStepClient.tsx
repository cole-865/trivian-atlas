"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { splitCustomerName } from "@/lib/deals/customerName";
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

  move_in_date: string;

  banking_checking: boolean;
  banking_savings: boolean;
  banking_prepaid: boolean;
};

type SaveState = "idle" | "saving" | "saved" | "error";

type ApiErrorLike = {
  details?: string;
  error?: string;
  message?: string;
};

type PersonApiRow = PersonForm & {
  role: Role;
};

type PeopleResponse = {
  people?: PersonApiRow[];
} & ApiErrorLike;

const emptyForm = (): PersonForm => ({
  first_name: "",
  last_name: "",
  phone: "",
  email: "",
  address_line1: "",
  city: "",
  state: "",
  zip: "",
  move_in_date: "",
  banking_checking: false,
  banking_savings: false,
  banking_prepaid: false,
});

function roleLabel(role: Role) {
  return role === "primary" ? "Driver" : "Co-app";
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
    p.move_in_date.trim() ||
    p.banking_checking ||
    p.banking_savings ||
    p.banking_prepaid
  );
}

function primaryNameOk(p: PersonForm) {
  return p.first_name.trim().length > 0 && p.last_name.trim().length > 0;
}

function primaryResidenceOk(p: PersonForm) {
  return p.move_in_date.trim().length > 0;
}

function formatSaveError(j: unknown, fallback: string) {
  if (typeof j === "object" && j) {
    const payload = j as ApiErrorLike;
    return payload.details || payload.error || payload.message || fallback;
  }
  return (
    (typeof j === "string" ? j : null) ||
    fallback
  );
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formsEqual(a: PersonForm, b: PersonForm) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function getResidenceBreakdown(moveInDate: string) {
  if (!moveInDate) return { years: "", months: "" };

  const parts = moveInDate.split("-");
  if (parts.length !== 3) return { years: "", months: "" };

  const [y, m, d] = parts.map(Number);
  const move = new Date(y, m - 1, d);
  const today = new Date();

  if (Number.isNaN(move.getTime()) || move > today) {
    return { years: "0", months: "0" };
  }

  let totalMonths =
    (today.getFullYear() - move.getFullYear()) * 12 +
    (today.getMonth() - move.getMonth());

  if (today.getDate() < move.getDate()) {
    totalMonths -= 1;
  }

  totalMonths = Math.max(0, totalMonths);

  return {
    years: String(Math.floor(totalMonths / 12)),
    months: String(totalMonths % 12),
  };
}

export default function CustomerStepClient({
  dealId,
  initialCustomerName,
}: {
  dealId: string;
  initialCustomerName?: string | null;
}) {
  const router = useRouter();

  const [activeRole, setActiveRole] = useState<Role>("primary");
  const [loading, setLoading] = useState(true);
  const [navBusy, setNavBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [people, setPeople] = useState<Record<Role, PersonForm>>({
    primary: emptyForm(),
    co: emptyForm(),
  });

  const [lastSavedPeople, setLastSavedPeople] = useState<Record<Role, PersonForm>>({
    primary: emptyForm(),
    co: emptyForm(),
  });

  const [docStatus, setDocStatus] = useState({
    credit_bureau: false,
  });

  const [saveStateByRole, setSaveStateByRole] = useState<Record<Role, SaveState>>({
    primary: "idle",
    co: "idle",
  });

  const activeForm = useMemo(() => people[activeRole], [people, activeRole]);

  const activeResidence = useMemo(
    () => getResidenceBreakdown(activeForm.move_in_date),
    [activeForm.move_in_date]
  );

  const primaryOk = useMemo(() => primaryNameOk(people.primary), [people.primary]);
  const primaryResidenceComplete = useMemo(
    () => primaryResidenceOk(people.primary),
    [people.primary]
  );

  const docsOk = docStatus.credit_bureau;
  const anySaving = saveStateByRole.primary === "saving" || saveStateByRole.co === "saving";
  const canNext =
    primaryOk &&
    primaryResidenceComplete &&
    docsOk &&
    !loading &&
    !navBusy &&
    !anySaving;

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveSequenceRef = useRef<Record<Role, number>>({
    primary: 0,
    co: 0,
  });
  const firstLoadDoneRef = useRef(false);
  const saveBadgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const r = await fetch(`/api/deals/${dealId}/people`, { method: "GET" });
        const j = (await r.json().catch(() => ({}))) as PeopleResponse;

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
            move_in_date: p.move_in_date ?? "",
            banking_checking: !!p.banking_checking,
            banking_savings: !!p.banking_savings,
            banking_prepaid: !!p.banking_prepaid,
          };
        }

        const primaryHasSavedName =
          next.primary.first_name.trim().length > 0 || next.primary.last_name.trim().length > 0;

        if (!primaryHasSavedName && initialCustomerName) {
          const splitName = splitCustomerName(initialCustomerName);
          next.primary = {
            ...next.primary,
            first_name: splitName.firstName,
            last_name: splitName.lastName,
          };
        }

        if (!cancelled) {
          setPeople(next);
          setLastSavedPeople(
            primaryHasSavedName || !initialCustomerName
              ? next
              : {
                  ...next,
                  primary: emptyForm(),
                }
          );
          setSaveStateByRole({
            primary: "idle",
            co: "idle",
          });
          firstLoadDoneRef.current = true;
        }
      } catch (e: unknown) {
        if (!cancelled) setError(errorMessage(e, "Load error"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
      const autosaveTimer = autosaveTimerRef.current;
      const saveBadgeTimer = saveBadgeTimerRef.current;
      if (autosaveTimer) clearTimeout(autosaveTimer);
      if (saveBadgeTimer) clearTimeout(saveBadgeTimer);
    };
  }, [dealId, initialCustomerName]);

  function updateField<K extends keyof PersonForm>(key: K, value: PersonForm[K]) {
    setPeople((prev) => ({
      ...prev,
      [activeRole]: {
        ...prev[activeRole],
        [key]: value,
      },
    }));

    setSaveStateByRole((prev) => ({
      ...prev,
      [activeRole]: "idle",
    }));
  }

  async function saveRole(role: Role, opts?: { silent?: boolean }) {
    const silent = !!opts?.silent;
    const current = people[role];
    const lastSaved = lastSavedPeople[role];

    if (!hasAnyData(current)) {
      if (role === "co") {
        setSaveStateByRole((prev) => ({ ...prev, [role]: "idle" }));
        return;
      }
    }

    if (role === "primary" && !primaryNameOk(current)) {
      if (!silent) {
        const msg = "Driver first + last name are required.";
        setError(msg);
        setSaveStateByRole((prev) => ({ ...prev, [role]: "error" }));
      }
      return;
    }

    if (role === "primary" && !primaryResidenceOk(current)) {
      if (!silent) {
        const msg = "Driver move-in date is required.";
        setError(msg);
        setSaveStateByRole((prev) => ({ ...prev, [role]: "error" }));
      }
      return;
    }

    if (formsEqual(current, lastSaved)) return;

    const seq = ++saveSequenceRef.current[role];

    setSaveStateByRole((prev) => ({
      ...prev,
      [role]: "saving",
    }));

    if (!silent) setError(null);

    try {
      const r = await fetch(`/api/deals/${dealId}/people/${role}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(current),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(formatSaveError(j, "Save failed"));

      if (saveSequenceRef.current[role] !== seq) return;

      setLastSavedPeople((prev) => ({
        ...prev,
        [role]: current,
      }));

      setSaveStateByRole((prev) => ({
        ...prev,
        [role]: "saved",
      }));

      if (saveBadgeTimerRef.current) clearTimeout(saveBadgeTimerRef.current);
      saveBadgeTimerRef.current = setTimeout(() => {
        setSaveStateByRole((prev) => ({
          ...prev,
          [role]: prev[role] === "saved" ? "idle" : prev[role],
        }));
      }, 1500);
    } catch (e: unknown) {
      if (saveSequenceRef.current[role] !== seq) return;

      setSaveStateByRole((prev) => ({
        ...prev,
        [role]: "error",
      }));

      if (!silent) {
        setError(errorMessage(e, "Save error"));
      }
    }
  }

  useEffect(() => {
    if (!firstLoadDoneRef.current) return;
    if (loading || navBusy) return;

    const current = people[activeRole];
    const lastSaved = lastSavedPeople[activeRole];

    if (formsEqual(current, lastSaved)) return;

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);

    autosaveTimerRef.current = setTimeout(() => {
      void saveRole(activeRole, {
        silent:
          activeRole === "primary" &&
          (!primaryNameOk(current) || !primaryResidenceOk(current)),
      });
    }, 900);

    return () => {
      const autosaveTimer = autosaveTimerRef.current;
      if (autosaveTimer) clearTimeout(autosaveTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, activeRole, loading, navBusy, lastSavedPeople]);

  function nextBlockerMessage() {
    if (!primaryOk) return "Enter Driver first + last name to continue.";
    if (!primaryResidenceComplete) return "Enter Driver move-in date to continue.";
    if (!docsOk) return "Upload Credit Bureau PDFs before continuing.";
    return null;
  }

  async function onPrev() {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    await saveRole("primary", { silent: true });
    await saveRole("co", { silent: true });
    router.push("/deals");
  }

  async function onNext() {
    setError(null);

    const blocker = nextBlockerMessage();
    if (blocker) {
      setError(blocker);
      return;
    }

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);

    setNavBusy(true);
    try {
      await saveRole("primary");
      await saveRole("co", { silent: true });
      router.push(`/deals/${dealId}/income`);
    } finally {
      setNavBusy(false);
    }
  }

  const activeRoleSaveState = saveStateByRole[activeRole];
  const headerStatus = (() => {
    if (loading) return "Loading…";
    if (navBusy) return "Continuing…";
    if (activeRoleSaveState === "saving") return `Saving ${roleLabel(activeRole)}…`;
    if (activeRoleSaveState === "saved") return `${roleLabel(activeRole)} saved`;
    if (activeRoleSaveState === "error") return `Error saving ${roleLabel(activeRole)}`;
    return null;
  })();

  const hasUnsavedActiveChanges = !formsEqual(
    people[activeRole],
    lastSavedPeople[activeRole]
  );

  const hasAnyUnsavedChanges =
    !formsEqual(people.primary, lastSavedPeople.primary) ||
    !formsEqual(people.co, lastSavedPeople.co);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!hasAnyUnsavedChanges) return;

      e.preventDefault();
      e.returnValue = "";
    };

    window.addEventListener("beforeunload", handler);

    return () => {
      window.removeEventListener("beforeunload", handler);
    };
  }, [hasAnyUnsavedChanges]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[220px]">
          <h2 className="m-0 text-lg font-semibold">Step 1: Customer</h2>
          <div className="text-xs text-muted-foreground">
            Required: Driver name + move-in date + Credit Bureau PDF.
          </div>
        </div>

        {headerStatus ? (
          <span
            className={[
              "rounded-full px-2.5 py-1 text-xs font-medium",
              activeRoleSaveState === "saving"
                ? "bg-gray-100 text-gray-700"
                : activeRoleSaveState === "saved"
                  ? "bg-green-100 text-green-700"
                  : activeRoleSaveState === "error"
                    ? "bg-red-100 text-red-700"
                    : "text-muted-foreground",
            ].join(" ")}
          >
            {headerStatus}
          </span>
        ) : hasUnsavedActiveChanges ? (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
            Unsaved changes
          </span>
        ) : null}

        {error ? <span className="text-sm text-red-600">{error}</span> : null}

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

      <div className="rounded-2xl border bg-white p-4 shadow-sm grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {(["primary", "co"] as Role[]).map((r) => {
            const state = saveStateByRole[r];

            return (
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
                {state === "saving" ? " · Saving…" : ""}
                {state === "saved" ? " · Saved" : ""}
                {state === "error" ? " · Error" : ""}
              </button>
            );
          })}

          <div className="flex-1" />

          <button
            type="button"
            onClick={() => saveRole(activeRole)}
            disabled={loading || anySaving || navBusy}
            className={[
              "rounded-xl px-3 py-2 text-sm font-semibold text-white",
              loading || anySaving || navBusy
                ? "bg-gray-400 cursor-not-allowed"
                : "bg-black hover:opacity-90",
            ].join(" ")}
            title={
              activeRole === "primary" && !primaryOk
                ? "Driver first + last name required to save"
                : activeRole === "primary" && !primaryResidenceComplete
                  ? "Driver move-in date required to save"
                  : hasAnyData(activeForm)
                    ? ""
                    : "Nothing to save"
            }
          >
            Save {roleLabel(activeRole)}
          </button>
        </div>

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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <ReadonlyField label="Years" value={activeResidence.years} />
            <ReadonlyField label="Months" value={activeResidence.months} />
            <DateField
              label="Move-in Date"
              value={activeForm.move_in_date}
              onChange={(v) => updateField("move_in_date", v)}
              required={activeRole === "primary"}
              invalid={activeRole === "primary" && !activeForm.move_in_date.trim()}
            />
            <div className="text-xs text-muted-foreground pb-2">
              Residence time is calculated from move-in date.
            </div>
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

      <div className="rounded-2xl border bg-white p-4 shadow-sm grid gap-3">
        <CustomerDocuments
          dealId={dealId}
          onStatus={(s: { credit_app: boolean; credit_bureau: boolean }) => {
            setDocStatus({
              credit_bureau: s.credit_bureau,
            });

            if (s.credit_bureau && error?.toLowerCase().includes("upload")) {
              setError(null);
            }
          }}
        />
      </div>

      <div className="text-xs text-muted-foreground">
        Required to continue:{" "}
        <b>
          Driver name {primaryOk ? "✓" : "✗"} · Move-in date{" "}
          {primaryResidenceComplete ? "✓" : "✗"} · Credit Bureau{" "}
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
        {label} {required ? <span className="text-red-600 font-semibold">*</span> : null}
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

function DateField({
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
        {label} {required ? <span className="text-red-600 font-semibold">*</span> : null}
      </div>
      <input
        type="date"
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

function ReadonlyField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <label className="grid gap-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <input
        value={value}
        readOnly
        className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none"
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
