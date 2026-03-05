import Link from "next/link";
import { createClient } from "@/utils/supabase/server";

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="block rounded-xl px-3 py-2 text-sm hover:bg-gray-100"
    >
      {label}
    </Link>
  );
}

async function DealSearch() {
  // Server component form -> just GETs /deals with querystring
  return (
    <form action="/deals" method="get" className="w-full max-w-sm">
      <input
        name="q"
        placeholder="Search deals (name, ID)…"
        className="w-full rounded-xl border px-3 py-2 text-sm"
      />
    </form>
  );
}

async function UserPill() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  const email = data.user?.email ?? "Signed in";

  return (
    <div className="flex items-center gap-2">
      <div className="hidden sm:block text-xs text-muted-foreground">{email}</div>

      <Link
        href="/settings"
        className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
      >
        Settings
      </Link>

      <form action="/logout" method="post">
        <button
          type="submit"
          className="rounded-xl bg-black px-3 py-2 text-sm text-white hover:opacity-90"
        >
          Logout
        </button>
      </form>
    </div>
  );
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="flex">
        {/* Sidebar */}
        <aside className="w-64 shrink-0 border-r bg-white min-h-screen">
          <div className="p-4">
            <div className="text-lg font-semibold">Trivian Atlas</div>
            <div className="text-xs text-muted-foreground">Internal underwriting</div>
          </div>

          <nav className="px-2 pb-4 space-y-1">
            <NavLink href="/home" label="Home" />
            <NavLink href="/approvals" label="Approvals" />
            <NavLink href="/messages" label="Messages" />
            <NavLink href="/deals" label="Deals" />
            <NavLink href="/settings" label="Settings" />
          </nav>
        </aside>

        {/* Main */}
        <div className="flex-1">
          {/* Top bar */}
          <div className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
            <div className="mx-auto max-w-6xl px-6 py-4">
              <div className="flex items-center justify-between gap-3">
                <DealSearch />
                <UserPill />
              </div>
            </div>
          </div>

          <main className="mx-auto max-w-6xl px-6 py-6">{children}</main>
        </div>
      </div>
    </div>
  );
}