"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCurrentOrganizationAction } from "@/lib/auth/organizationActions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

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
      <div className={compact ? "grid gap-1.5" : "grid gap-2"}>
        <Label className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {compact ? "Account" : "Switch account"}
        </Label>
        <Select
          value={currentOrganizationId ?? undefined}
          onValueChange={onChange}
          disabled={isPending}
        >
          <SelectTrigger className="bg-card/80">
            <SelectValue placeholder="Select account" />
          </SelectTrigger>
          <SelectContent>
            {organizations.map((organization) => (
              <SelectItem key={organization.id} value={organization.id}>
                {organization.name}
                {organization.isActive ? "" : " [inactive]"} ({organization.roleLabel})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
