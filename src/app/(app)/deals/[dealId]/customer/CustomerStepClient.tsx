"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { splitCustomerName } from "@/lib/deals/customerName";
import { formatPhoneNumber, normalizePhoneForStorage } from "@/lib/formatting/phone";
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

type AddressSuggestion = {
  placeId?: string;
  label: string;
  address_line1: string;
  city: string;
  state: string;
  zip: string;
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

function addressFieldsEqual(a: PersonForm, b: PersonForm) {
  return (
    a.address_line1 === b.address_line1 &&
    a.city === b.city &&
    a.state === b.state &&
    a.zip === b.zip
  );
}

function parseAddressSuggestions(payload: unknown): AddressSuggestion[] {
  if (!Array.isArray(payload)) return [];

  return payload.reduce<AddressSuggestion[]>((acc, item) => {
      if (!item || typeof item !== "object") return acc;

      const value = item as {
        placeId?: string;
        label?: string;
        address_line1?: string;
        city?: string;
        state?: string;
        zip?: string;
      };

      const suggestion: AddressSuggestion = {
        placeId: value.placeId?.trim() || undefined,
        label: value.label?.trim() ?? "",
        address_line1: value.address_line1?.trim() ?? "",
        city: value.city?.trim() ?? "",
        state: value.state?.trim() ?? "",
        zip: value.zip?.trim() ?? "",
      };

      if (suggestion.label) {
        acc.push(suggestion);
      }

      return acc;
    }, []);
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
    primary: false,
    co: false,
  });

  const [saveStateByRole, setSaveStateByRole] = useState<Record<Role, SaveState>>({
    primary: "idle",
    co: "idle",
  });
  const [sameAsApplicant, setSameAsApplicant] = useState(false);
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([]);
  const [addressSearchBusy, setAddressSearchBusy] = useState(false);
  const [addressSearchError, setAddressSearchError] = useState<string | null>(null);

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

  const docsOk = docStatus.primary;
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
  const addressLookupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addressLookupAbortRef = useRef<AbortController | null>(null);
  const householdIncomeRequestRef = useRef(0);
  const suppressNextAddressLookupRef = useRef(false);
  const addressLookupArmedRef = useRef(false);

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
            phone: formatPhoneNumber(p.phone ?? ""),
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
          setSameAsApplicant(
            !!next.co.address_line1.trim() && addressFieldsEqual(next.primary, next.co)
          );
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
      const addressLookupTimer = addressLookupTimerRef.current;
      const addressLookupAbort = addressLookupAbortRef.current;
      if (autosaveTimer) clearTimeout(autosaveTimer);
      if (saveBadgeTimer) clearTimeout(saveBadgeTimer);
      if (addressLookupTimer) clearTimeout(addressLookupTimer);
      if (addressLookupAbort) addressLookupAbort.abort();
    };
  }, [dealId, initialCustomerName]);

  function updateRole(role: Role, updater: (current: PersonForm) => PersonForm) {
    setPeople((prev) => {
      const nextRole = updater(prev[role]);

      return {
        ...prev,
        [role]: nextRole,
        ...(role === "primary" && sameAsApplicant
          ? {
              co: {
                ...prev.co,
                address_line1: nextRole.address_line1,
                city: nextRole.city,
                state: nextRole.state,
                zip: nextRole.zip,
              },
            }
          : {}),
      };
    });

    setSaveStateByRole((prev) => ({
      ...prev,
      [role]: "idle",
      ...(role === "primary" && sameAsApplicant ? { co: "idle" } : {}),
    }));
  }

  function updateField<K extends keyof PersonForm>(key: K, value: PersonForm[K], role = activeRole) {
    updateRole(role, (current) => ({
      ...current,
      [key]: value,
    }));
  }

  function updateAddressField<K extends "address_line1" | "city" | "state" | "zip">(
    key: K,
    value: PersonForm[K],
    role = activeRole
  ) {
    if (key === "address_line1") {
      addressLookupArmedRef.current = true;
    }
    updateField(key, value, role);
  }

  async function setHouseholdIncomeChecked(next: boolean) {
    const requestId = ++householdIncomeRequestRef.current;

    try {
      const r = await fetch(`/api/deals/${dealId}/household-income`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ household_income: next }),
      });
      const j = (await r.json().catch(() => ({}))) as ApiErrorLike;

      if (!r.ok) {
        throw new Error(formatSaveError(j, "Failed to update household income"));
      }
    } catch (e: unknown) {
      if (householdIncomeRequestRef.current !== requestId) return;
      setError(errorMessage(e, "Failed to update household income"));
    } finally {
      if (householdIncomeRequestRef.current === requestId) {
        router.refresh();
      }
    }
  }

  async function applyAddressSuggestion(role: Role, suggestion: AddressSuggestion) {
    if (suggestion.placeId) {
      setAddressSearchBusy(true);
      setAddressSearchError(null);

      try {
        const r = await fetch(
          `/api/deals/${dealId}/address-autocomplete?placeId=${encodeURIComponent(suggestion.placeId)}`,
          {
            cache: "no-store",
          }
        );
        const j = (await r.json().catch(() => ({}))) as
          | { address?: AddressSuggestion }
          | ApiErrorLike;

        if (!r.ok || !("address" in j) || !j.address) {
          throw new Error(formatSaveError(j, "Failed to load address details"));
        }

        const address = j.address;
        suppressNextAddressLookupRef.current = true;
        addressLookupArmedRef.current = false;

        updateRole(role, (current) => ({
          ...current,
          address_line1: address.address_line1,
          city: address.city,
          state: address.state,
          zip: address.zip,
        }));
      } catch (e: unknown) {
        setAddressSearchError(errorMessage(e, "Failed to load address details"));
        return;
      } finally {
        setAddressSearchBusy(false);
      }
    } else {
      suppressNextAddressLookupRef.current = true;
      addressLookupArmedRef.current = false;
      updateRole(role, (current) => ({
        ...current,
        address_line1: suggestion.address_line1,
        city: suggestion.city,
        state: suggestion.state,
        zip: suggestion.zip,
      }));
    }

    setAddressSuggestions([]);
    setAddressSearchError(null);
  }

  async function toggleSameAsApplicant(checked: boolean) {
    setSameAsApplicant(checked);

    if (!checked) return;

    setAddressSuggestions([]);
    updateRole("co", (current) => ({
      ...current,
      address_line1: people.primary.address_line1,
      city: people.primary.city,
      state: people.primary.state,
      zip: people.primary.zip,
    }));
    void setHouseholdIncomeChecked(true);
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
        body: JSON.stringify({
          ...current,
          phone: normalizePhoneForStorage(current.phone),
        }),
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

  useEffect(() => {
    const activeAddress = people[activeRole].address_line1.trim();
    const shouldSearch =
      activeRole !== "co" || !sameAsApplicant;

    if (addressLookupTimerRef.current) clearTimeout(addressLookupTimerRef.current);
    if (addressLookupAbortRef.current) {
      addressLookupAbortRef.current.abort();
      addressLookupAbortRef.current = null;
    }

    if (!addressLookupArmedRef.current) {
      return;
    }

    if (suppressNextAddressLookupRef.current) {
      suppressNextAddressLookupRef.current = false;
      return;
    }

    if (!shouldSearch || activeAddress.length < 4) {
      queueMicrotask(() => {
        setAddressSuggestions([]);
        setAddressSearchBusy(false);
        setAddressSearchError(null);
      });
      return;
    }

    addressLookupTimerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      addressLookupAbortRef.current = controller;
      setAddressSearchBusy(true);
      setAddressSearchError(null);

      try {
        const response = await fetch(
          `/api/deals/${dealId}/address-autocomplete?q=${encodeURIComponent(activeAddress)}`,
          {
            signal: controller.signal,
            cache: "no-store",
          }
        );

        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as ApiErrorLike;
          throw new Error(formatSaveError(payload, "Address suggestions are unavailable right now."));
        }

        const payload = (await response.json()) as unknown;
        const suggestions =
          typeof payload === "object" &&
          payload &&
          "suggestions" in payload
            ? parseAddressSuggestions((payload as { suggestions?: unknown }).suggestions)
            : [];
        setAddressSuggestions(suggestions);
      } catch (e: unknown) {
        if (controller.signal.aborted) return;
        setAddressSuggestions([]);
        setAddressSearchError(errorMessage(e, "Address suggestions are unavailable right now."));
      } finally {
        if (!controller.signal.aborted) {
          setAddressSearchBusy(false);
        }
      }
    }, 300);

    return () => {
      if (addressLookupTimerRef.current) clearTimeout(addressLookupTimerRef.current);
    };
  }, [activeRole, dealId, people, sameAsApplicant]);

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
          <div className="text-xs uppercase tracking-[0.08em] text-muted-foreground/75">
            Required: Driver name + move-in date + Credit Bureau PDF.
          </div>
        </div>

        {headerStatus ? (
          <span
            className={[
              "rounded-full px-2.5 py-1 text-xs font-medium",
              activeRoleSaveState === "saving"
                ? "border border-border/75 bg-background/40 text-muted-foreground"
                : activeRoleSaveState === "saved"
                  ? "border border-success/30 bg-success/12 text-success"
                  : activeRoleSaveState === "error"
                    ? "border border-destructive/30 bg-destructive/12 text-destructive"
                    : "text-muted-foreground/80",
            ].join(" ")}
          >
            {headerStatus}
          </span>
        ) : hasUnsavedActiveChanges ? (
          <span className="rounded-full border border-warning/30 bg-warning/12 px-2.5 py-1 text-xs font-medium text-warning">
            Unsaved changes
          </span>
        ) : null}

        {error ? <span className="text-sm text-destructive">{error}</span> : null}

        <div className="flex-1" />

        <button
          type="button"
          onClick={onPrev}
          className="rounded-xl border border-border/75 bg-background/35 px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-accent/80"
        >
          ← Previous
        </button>

        <button
          type="button"
          onClick={onNext}
          disabled={!canNext}
          className={[
            "rounded-xl px-3 py-2 text-sm font-semibold text-primary-foreground",
            canNext ? "bg-primary hover:bg-primary/90" : "cursor-not-allowed bg-muted text-muted-foreground",
          ].join(" ")}
          title={!canNext ? nextBlockerMessage() ?? "" : ""}
        >
          Next →
        </button>
      </div>

      <div className="grid gap-3 rounded-2xl border border-border/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] p-4 shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
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
                    ? "border-primary/30 bg-primary/12 text-primary"
                    : "border-border/75 bg-background/35 text-foreground hover:bg-accent/80",
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
              "rounded-xl px-3 py-2 text-sm font-semibold text-primary-foreground",
              loading || anySaving || navBusy
                ? "cursor-not-allowed bg-muted text-muted-foreground"
                : "bg-primary hover:bg-primary/90",
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
              onChange={(v) => updateField("phone", formatPhoneNumber(v))}
              inputMode="tel"
            />
            <Field
              label="Email"
              value={activeForm.email}
              onChange={(v) => updateField("email", v)}
            />
          </div>

          {activeRole === "co" ? (
            <div className="rounded-xl border border-border/75 bg-background/20 px-3 py-2">
              <Checkbox
                label="Same as applicant"
                checked={sameAsApplicant}
                onChange={(v) => {
                  void toggleSameAsApplicant(v);
                }}
              />
            </div>
          ) : null}

          <AddressAutocompleteField
            label="Address"
            value={activeForm.address_line1}
            onChange={(v) => updateAddressField("address_line1", v)}
            onSelect={(suggestion) => {
              void applyAddressSuggestion(activeRole, suggestion);
            }}
            suggestions={addressSuggestions}
            loading={addressSearchBusy}
            error={addressSearchError}
            disabled={activeRole === "co" && sameAsApplicant}
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field
              label="City"
              value={activeForm.city}
              onChange={(v) => updateAddressField("city", v)}
              disabled={activeRole === "co" && sameAsApplicant}
            />
            <Field
              label="State"
              value={activeForm.state}
              onChange={(v) => updateAddressField("state", v)}
              disabled={activeRole === "co" && sameAsApplicant}
            />
            <Field
              label="ZIP"
              value={activeForm.zip}
              onChange={(v) => updateAddressField("zip", v)}
              disabled={activeRole === "co" && sameAsApplicant}
              inputMode="numeric"
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

      <div className="grid gap-3 rounded-2xl border border-border/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] p-4 shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
        <CustomerDocuments
          dealId={dealId}
          applicantRole={activeRole}
          onStatus={(s: { applicant_role: Role; credit_app: boolean; credit_bureau: boolean }) => {
            setDocStatus((prev) => ({
              ...prev,
              [s.applicant_role]: s.credit_bureau,
            }));

            if (s.credit_bureau && error?.toLowerCase().includes("upload")) {
              setError(null);
            }
          }}
        />
      </div>

      <div className="text-xs uppercase tracking-[0.08em] text-muted-foreground/75">
        Required to continue:{" "}
        <b>
          Driver name {primaryOk ? "✓" : "✗"} · Move-in date{" "}
          {primaryResidenceComplete ? "✓" : "✗"} · Driver Credit Bureau{" "}
          {docStatus.primary ? "✓" : "✗"}
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
  disabled,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  return (
    <label className="grid gap-1">
      <div className="text-xs text-muted-foreground/80">
        {label} {required ? <span className="font-semibold text-destructive">*</span> : null}
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        inputMode={inputMode}
        className={[
          "rounded-xl border bg-background/35 px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary/50",
          disabled ? "cursor-not-allowed opacity-60" : "",
          invalid ? "border-destructive/60" : "border-border/75",
        ].join(" ")}
      />
    </label>
  );
}

function AddressAutocompleteField({
  label,
  value,
  onChange,
  onSelect,
  suggestions,
  loading,
  error,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSelect: (suggestion: AddressSuggestion) => void;
  suggestions: AddressSuggestion[];
  loading: boolean;
  error: string | null;
  disabled?: boolean;
}) {
  const showSuggestions = !disabled && suggestions.length > 0;

  return (
    <div className="grid gap-1">
      <Field
        label={label}
        value={value}
        onChange={onChange}
        disabled={disabled}
      />

      {loading ? (
        <div className="text-xs text-muted-foreground/75">Looking up addresses…</div>
      ) : null}

      {error ? (
        <div className="text-xs text-warning">{error}</div>
      ) : null}

      {showSuggestions ? (
        <div className="grid gap-1 rounded-xl border border-border/75 bg-background/75 p-2">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.label}
              type="button"
              onClick={() => onSelect(suggestion)}
              className="rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent/80"
            >
              {suggestion.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
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
      <div className="text-xs text-muted-foreground/80">
        {label} {required ? <span className="font-semibold text-destructive">*</span> : null}
      </div>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={[
          "rounded-xl border bg-background/35 px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary/50",
          invalid ? "border-destructive/60" : "border-border/75",
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
      <div className="text-xs text-muted-foreground/80">{label}</div>
      <input
        value={value}
        readOnly
        className="rounded-xl border border-border/75 bg-background/25 px-3 py-2 text-sm text-foreground/90 outline-none"
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
