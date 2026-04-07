import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { stopImpersonationAction } from "@/lib/auth/impersonationActions";
import { getAuthContext, type AuthContext } from "@/lib/auth/userRole";

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

function displayUserLabel(args: {
  fullName?: string | null;
  email?: string | null;
  fallback: string;
}) {
  return args.fullName || args.email || args.fallback;
}

function UserPill({ authContext }: { authContext: AuthContext }) {
  const effectiveLabel = displayUserLabel({
    fullName: authContext.effectiveProfile?.fullName ?? null,
    email:
      authContext.effectiveProfile?.email ??
      authContext.realProfile?.email ??
      authContext.realUser?.email ??
      null,
    fallback: "Signed in",
  });

  return (
    <div className="flex items-center gap-2">
      <div className="hidden sm:block text-xs text-muted-foreground">
        {effectiveLabel}
      </div>

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
  const supabase = await createClient();
  const authContext = await getAuthContext(supabase);
  const showImpersonationBanner =
    authContext.isImpersonating &&
    authContext.impersonatedProfile &&
    authContext.realUser;

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
            {authContext.realRole === "dev" ? (
              <NavLink href="/dev-tools" label="DEV TOOLS" />
            ) : null}
          </nav>
        </aside>

        {/* Main */}
        <div className="flex-1">
          {showImpersonationBanner && authContext.impersonatedProfile && authContext.realUser ? (
            <div className="border-b border-amber-300 bg-amber-100">
              <div className="flex items-center justify-between gap-4 px-6 py-3 text-sm">
                <div className="text-amber-950">
                  Acting as{" "}
                  <span className="font-semibold">
                    {authContext.impersonatedProfile.fullName ||
                      authContext.impersonatedProfile.email ||
                      authContext.impersonatedProfile.role}
                  </span>
                  . Real user is{" "}
                  <span className="font-semibold">
                    {authContext.realProfile?.fullName ||
                      authContext.realProfile?.email ||
                      authContext.realUser.email}
                  </span>
                  .
                </div>

                <form action={stopImpersonationAction}>
                  <button
                    type="submit"
                    className="rounded-xl border border-amber-400 bg-white px-3 py-2 text-sm hover:bg-amber-50"
                  >
                    Stop impersonating
                  </button>
                </form>
              </div>
            </div>
          ) : null}

          {/* Top bar */}
          <div className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
            <div className="w-full px-6 py-4">
              <div className="flex items-center justify-between gap-3">
                <DealSearch />
                <UserPill authContext={authContext} />
              </div>
            </div>
          </div>

          <main className="w-full px-6 py-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
