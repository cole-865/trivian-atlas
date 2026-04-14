"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
  type ReactNode,
} from "react";
import { useFormStatus } from "react-dom";

type FormAction = ComponentProps<"form">["action"];

type SaveState = {
  dirty: boolean;
};

const SaveStateContext = createContext<SaveState>({ dirty: true });

function formSignature(form: HTMLFormElement) {
  return Array.from(new FormData(form).entries())
    .map(([key, value]) => [key, typeof value === "string" ? value : value.name] as const)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      `${leftKey}:${leftValue}`.localeCompare(`${rightKey}:${rightValue}`)
    )
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function fieldChanged(target: EventTarget | null) {
  if (
    !(target instanceof HTMLInputElement) &&
    !(target instanceof HTMLSelectElement) &&
    !(target instanceof HTMLTextAreaElement)
  ) {
    return false;
  }

  if (target instanceof HTMLInputElement && target.type === "hidden") {
    return false;
  }

  if (target instanceof HTMLInputElement && target.type === "checkbox") {
    return target.checked !== target.defaultChecked;
  }

  if (target instanceof HTMLSelectElement) {
    return Array.from(target.options).some((option) => option.selected !== option.defaultSelected);
  }

  return target.value !== target.defaultValue;
}

function markChangedField(target: EventTarget | null) {
  if (
    !(target instanceof HTMLInputElement) &&
    !(target instanceof HTMLSelectElement) &&
    !(target instanceof HTMLTextAreaElement)
  ) {
    return;
  }

  if (target instanceof HTMLInputElement && target.type === "hidden") {
    return;
  }

  const changed = fieldChanged(target);
  target.classList.toggle("border-amber-400", changed);
  target.classList.toggle("bg-amber-50", changed);
  target.classList.toggle("ring-1", changed);
  target.classList.toggle("ring-amber-200", changed);
}

export function SettingsForm({
  action,
  children,
  className,
  disableSaveUntilDirty = true,
}: {
  action: FormAction;
  children: ReactNode;
  className?: string;
  disableSaveUntilDirty?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const initialSignature = useRef("");
  const [dirty, setDirty] = useState(!disableSaveUntilDirty);

  useEffect(() => {
    if (!formRef.current) return;
    initialSignature.current = formSignature(formRef.current);
  }, []);

  function updateDirty(event: FormEvent<HTMLFormElement>) {
    if (!formRef.current) return;
    markChangedField(event.target);
    setDirty(formSignature(formRef.current) !== initialSignature.current);
  }

  const value = useMemo(
    () => ({ dirty: disableSaveUntilDirty ? dirty : true }),
    [dirty, disableSaveUntilDirty]
  );

  return (
    <SaveStateContext.Provider value={value}>
      <form
        ref={formRef}
        action={action}
        className={className}
        onChange={updateDirty}
        onInput={updateDirty}
      >
        {children}
      </form>
    </SaveStateContext.Provider>
  );
}

export function SaveButton({
  children = "Save changes",
  pendingLabel = "Saving...",
  disabledWhenPristine = true,
  variant = "primary",
}: {
  children?: ReactNode;
  pendingLabel?: string;
  disabledWhenPristine?: boolean;
  variant?: "primary" | "secondary";
}) {
  const { pending } = useFormStatus();
  const { dirty } = useContext(SaveStateContext);

  const disabled = pending || (disabledWhenPristine && !dirty);
  const label = pending ? pendingLabel : children;
  const className =
    variant === "primary"
      ? "rounded-lg bg-black px-4 py-2 text-sm text-white hover:opacity-90 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600 disabled:hover:opacity-100"
      : "rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-400";

  return (
    <button type="submit" disabled={disabled} className={className}>
      {label}
    </button>
  );
}
