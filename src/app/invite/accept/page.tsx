import Link from "next/link";
import { acceptOrganizationInviteAction } from "@/lib/auth/organizationManagementActions";
import { validateInviteToken } from "@/lib/auth/organizationManagement";
import { createClient } from "@/utils/supabase/server";

function getSearchParam(
  searchParams: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function FlashBanner({
  tone,
  message,
}: {
  tone: "notice" | "error";
  message: string;
}) {
  const className =
    tone === "error"
      ? "border-red-200 bg-red-50 text-red-900"
      : "border-emerald-200 bg-emerald-50 text-emerald-900";

  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm ${className}`}>
      {message}
    </div>
  );
}

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const token = getSearchParam(resolvedSearchParams, "token") ?? "";
  const error = getSearchParam(resolvedSearchParams, "error");
  const notice = getSearchParam(resolvedSearchParams, "notice");

  if (!token) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="text-xl font-semibold">Invitation not found</div>
          <div className="mt-2 text-sm text-muted-foreground">
            The invite link is missing a token.
          </div>
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const validation = await validateInviteToken(token);

  if (!validation.invite || !validation.organization) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="text-xl font-semibold">Invitation not found</div>
          <div className="mt-2 text-sm text-muted-foreground">
            This invite link is invalid or no longer available.
          </div>
        </div>
      </div>
    );
  }

  const loginHref = `/login?email=${encodeURIComponent(validation.invite.email)}&redirect=${encodeURIComponent(`/invite/accept?token=${token}`)}`;

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="grid gap-6 rounded-2xl border bg-white p-6 shadow-sm">
        {notice ? <FlashBanner tone="notice" message={notice} /> : null}
        {error ? <FlashBanner tone="error" message={error} /> : null}

        <div>
          <div className="text-xl font-semibold">Accept account invite</div>
          <div className="mt-2 text-sm text-muted-foreground">
            Join {validation.organization.name} as {validation.invite.role}.
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm">
          <div className="font-medium">{validation.invite.fullName || validation.invite.email}</div>
          <div className="mt-1 text-muted-foreground">{validation.invite.email}</div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="rounded-full border px-2 py-1 uppercase tracking-wide">
              {validation.invite.role}
            </span>
            <span>Status: {validation.invite.status}</span>
            <span>Expires: {new Date(validation.invite.expiresAt).toLocaleString()}</span>
          </div>
        </div>

        {validation.invite.status === "revoked" ? (
          <div className="text-sm text-red-700">
            This invitation has been revoked. Ask an account admin to send a new invite.
          </div>
        ) : validation.isExpired ? (
          <div className="text-sm text-red-700">
            This invitation has expired. Ask an account admin to resend it.
          </div>
        ) : !user ? (
          <div className="grid gap-3">
            <div className="text-sm text-muted-foreground">
              Sign in or create an account with {validation.invite.email} to accept this invite.
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href={loginHref}
                className="rounded-xl bg-black px-4 py-2 text-sm text-white hover:opacity-90"
              >
                Continue to login
              </Link>
            </div>
          </div>
        ) : !user.email || user.email.toLowerCase() !== validation.invite.email.toLowerCase() ? (
          <div className="grid gap-3">
            <div className="text-sm text-red-700">
              You are signed in as {user.email ?? "an unknown account"}. This invite is for{" "}
              {validation.invite.email}.
            </div>
            <div className="flex flex-wrap gap-3">
              <form action="/api/logout" method="post">
                <button
                  type="submit"
                  className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
                >
                  Log out
                </button>
              </form>
              <Link
                href={loginHref}
                className="rounded-xl bg-black px-4 py-2 text-sm text-white hover:opacity-90"
              >
                Use invited email
              </Link>
            </div>
          </div>
        ) : validation.invite.status === "accepted" ? (
          <div className="grid gap-3">
            <div className="text-sm text-muted-foreground">
              This invitation has already been accepted.
            </div>
            <Link
              href="/home"
              className="rounded-xl bg-black px-4 py-2 text-sm text-white hover:opacity-90 inline-flex w-fit"
            >
              Go to app
            </Link>
          </div>
        ) : (
          <form action={acceptOrganizationInviteAction} className="grid gap-3">
            <input type="hidden" name="token" value={token} />
            <div className="text-sm text-muted-foreground">
              Accepting this invite will activate your membership and switch your current account.
            </div>
            <div>
              <button
                type="submit"
                className="rounded-xl bg-black px-4 py-2 text-sm text-white hover:opacity-90"
              >
                Accept invitation
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
