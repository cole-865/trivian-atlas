import Link from "next/link";
import { acceptOrganizationInviteAction } from "@/lib/auth/organizationManagementActions";
import { validateInviteToken } from "@/lib/auth/organizationManagement";
import { createClient } from "@/utils/supabase/server";
import { EmptyState, NoticeBanner, SectionCard } from "@/components/atlas/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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
  return <NoticeBanner tone={tone}>{message}</NoticeBanner>;
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
        <SectionCard title="Invitation not found" description="The invite link is missing a token.">
          <EmptyState
            className="min-h-32"
            title="Missing invite token"
            description="Check the full invite URL and try again."
          />
        </SectionCard>
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
        <SectionCard title="Invitation not found" description="This invite link is invalid or no longer available.">
          <EmptyState
            className="min-h-32"
            title="Invite unavailable"
            description="Ask an organization admin to send a fresh invitation."
          />
        </SectionCard>
      </div>
    );
  }

  const redirectTarget = `/invite/accept?token=${token}`;
  const loginHref = `/login?mode=login&email=${encodeURIComponent(validation.invite.email)}&redirect=${encodeURIComponent(redirectTarget)}`;
  const signupHref = `/login?mode=signup&email=${encodeURIComponent(validation.invite.email)}&redirect=${encodeURIComponent(redirectTarget)}`;

  return (
    <div className="mx-auto max-w-2xl p-6">
      <SectionCard
        eyebrow="Invitations"
        title="Accept account invite"
        description={`Join ${validation.organization.name} as ${validation.invite.role}.`}
      >
        {notice ? <FlashBanner tone="notice" message={notice} /> : null}
        {error ? <FlashBanner tone="error" message={error} /> : null}

        <div className="rounded-xl border border-border/75 bg-background/25 p-4 text-sm">
          <div className="font-medium text-foreground">{validation.invite.fullName || validation.invite.email}</div>
          <div className="mt-1 text-muted-foreground/82">{validation.invite.email}</div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground/78">
            <Badge variant="secondary">{validation.invite.role}</Badge>
            <span>Status: {validation.invite.status}</span>
            <span>Expires: {new Date(validation.invite.expiresAt).toLocaleString()}</span>
          </div>
        </div>

        {validation.invite.status === "revoked" ? (
          <NoticeBanner tone="error">
            This invitation has been revoked. Ask an account admin to send a new invite.
          </NoticeBanner>
        ) : validation.isExpired ? (
          <NoticeBanner tone="error">
            This invitation has expired. Ask an account admin to resend it.
          </NoticeBanner>
        ) : !user ? (
          <div className="grid gap-3">
            <div className="text-sm text-muted-foreground/82">
              Sign in or create an account with {validation.invite.email} to accept this invite.
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <Link href={loginHref}>Log in</Link>
              </Button>
              <Button asChild variant="secondary">
                <Link href={signupHref}>Create account</Link>
              </Button>
            </div>
          </div>
        ) : !user.email || user.email.toLowerCase() !== validation.invite.email.toLowerCase() ? (
          <div className="grid gap-3">
            <NoticeBanner tone="error">
              You are signed in as {user.email ?? "an unknown account"}. This invite is for{" "}
              {validation.invite.email}.
            </NoticeBanner>
            <div className="flex flex-wrap gap-3">
              <form action="/api/logout" method="post">
                <Button type="submit" variant="secondary">
                  Log out
                </Button>
              </form>
              <Button asChild>
                <Link href={loginHref}>Use invited email</Link>
              </Button>
            </div>
          </div>
        ) : validation.invite.status === "accepted" ? (
          <div className="grid gap-3">
            <div className="text-sm text-muted-foreground/82">
              This invitation has already been accepted.
            </div>
            <Button asChild className="w-fit">
              <Link href="/home">Go to app</Link>
            </Button>
          </div>
        ) : (
          <form action={acceptOrganizationInviteAction} className="grid gap-3">
            <input type="hidden" name="token" value={token} />
            <div className="text-sm text-muted-foreground/82">
              Accepting this invite will activate your membership and switch your current account.
            </div>
            <div>
              <Button type="submit">Accept invitation</Button>
            </div>
          </form>
        )}
      </SectionCard>
    </div>
  );
}
