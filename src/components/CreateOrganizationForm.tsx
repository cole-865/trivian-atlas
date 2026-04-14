"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function CreateOrganizationForm({
  action,
}: {
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  return (
    <form action={action} className="mt-4 grid gap-4 md:grid-cols-2">
      <label className="grid gap-2">
        <Label>Account name</Label>
        <Input
          name="name"
          required
          value={name}
          onChange={(event) => {
            const nextName = event.target.value;
            setName(nextName);
            if (!slugTouched) {
              setSlug(slugify(nextName));
            }
          }}
          placeholder="River City Motors"
        />
      </label>

      <label className="grid gap-2">
        <Label>Slug</Label>
        <Input
          name="slug"
          required
          value={slug}
          onChange={(event) => {
            setSlugTouched(true);
            setSlug(slugify(event.target.value));
          }}
          placeholder="river-city-motors"
        />
      </label>

      <label className="grid gap-2">
        <Label>Initial account admin name</Label>
        <Input
          name="initial_admin_name"
          required
          placeholder="Taylor Admin"
        />
      </label>

      <label className="grid gap-2">
        <Label>Initial account admin email</Label>
        <Input
          name="initial_admin_email"
          type="email"
          required
          placeholder="taylor@example.com"
        />
      </label>

      <div className="md:col-span-2">
        <Button type="submit">
          Create account
        </Button>
      </div>
    </form>
  );
}
