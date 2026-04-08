"use client";

import { useState } from "react";

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
        <span className="text-sm font-medium">Account name</span>
        <input
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
          className="rounded-xl border px-3 py-2 text-sm"
          placeholder="River City Motors"
        />
      </label>

      <label className="grid gap-2">
        <span className="text-sm font-medium">Slug</span>
        <input
          name="slug"
          required
          value={slug}
          onChange={(event) => {
            setSlugTouched(true);
            setSlug(slugify(event.target.value));
          }}
          className="rounded-xl border px-3 py-2 text-sm"
          placeholder="river-city-motors"
        />
      </label>

      <label className="grid gap-2">
        <span className="text-sm font-medium">Initial account admin name</span>
        <input
          name="initial_admin_name"
          required
          className="rounded-xl border px-3 py-2 text-sm"
          placeholder="Taylor Admin"
        />
      </label>

      <label className="grid gap-2">
        <span className="text-sm font-medium">Initial account admin email</span>
        <input
          name="initial_admin_email"
          type="email"
          required
          className="rounded-xl border px-3 py-2 text-sm"
          placeholder="taylor@example.com"
        />
      </label>

      <div className="md:col-span-2">
        <button
          type="submit"
          className="rounded-xl bg-black px-4 py-2 text-sm text-white hover:opacity-90"
        >
          Create account
        </button>
      </div>
    </form>
  );
}
