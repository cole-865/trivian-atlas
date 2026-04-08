"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCurrentOrganizationAction } from "@/lib/auth/organizationActions";

type OrganizationOption = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  roleLabel: string;
};

export function OrganizationSwitcher({
  organizations,
  currentOrganizationId,
  compact = false,
}: {
  organizations: OrganizationOption[];
  currentOrganizationId: string | null;
  compact?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (!organizations.length) {
    return null;
  }

  function onChange(nextOrganizationId: string) {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("organization_id", nextOrganizationId);
      await setCurrentOrganizationAction(formData);
      router.refresh();
    });
  }

  return (
    <div className={compact ? "min-w-56" : "grid gap-3"}>
      <label className={compact ? "grid gap-1" : "grid gap-2"}>
        <span className="text-xs font-medium text-muted-foreground">
          {compact ? "Account" : "Switch account"}
        </span>
        <select
          name="organization_id"
          value={currentOrganizationId ?? ""}
          onChange={(event) => onChange(event.target.value)}
          disabled={isPending}
          className="rounded-xl border bg-white px-3 py-2 text-sm disabled:opacity-60"
        >
          <option value="" disabled>
            Select account
          </option>
          {organizations.map((organization) => (
            <option key={organization.id} value={organization.id}>
              {organization.name}
              {organization.isActive ? "" : " [inactive]"} ({organization.roleLabel})
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
