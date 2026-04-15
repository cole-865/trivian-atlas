"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { NoticeBanner, SectionCard } from "@/components/atlas/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabaseBrowser } from "@/lib/supabase/client";

function LoginPageContent() {
  const supabase = supabaseBrowser();
  const searchParams = useSearchParams();

  const redirectTo = useMemo(() => {
    const requested = searchParams.get("redirect");
    return requested && requested.startsWith("/") ? requested : "/";
  }, [searchParams]);

  const inviteEmail = searchParams.get("email") ?? "";
  const pageNotice = searchParams.get("notice");
  const requestedMode = searchParams.get("mode");

  const [email, setEmail] = useState(inviteEmail);
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">(
    requestedMode === "signup" ? "signup" : "login"
  );
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(pageNotice);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);

    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        window.location.href = redirectTo;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo:
              typeof window !== "undefined"
                ? `${window.location.origin}${redirectTo}`
                : undefined,
          },
        });
        if (error) throw error;

        if (data.session) {
          window.location.href = redirectTo;
          return;
        }

        setMsg(
          "Account created. Check your email to confirm the account, then come back and log in to accept the invite."
        );
        setMode("login");
      }
    } catch (err: unknown) {
      setMsg(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <SectionCard
          eyebrow="Access"
          title="Atlas"
          description={
            mode === "login"
              ? "Log in to continue."
              : "Create an account with the email address that was invited."
          }
        >
          {inviteEmail ? (
            <NoticeBanner tone="notice">
              Invite email: <span className="font-medium">{inviteEmail}</span>
            </NoticeBanner>
          ) : null}

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
              />
            </div>

            {msg ? (
              <NoticeBanner tone={pageNotice ? "notice" : "error"}>{msg}</NoticeBanner>
            ) : null}

            <Button className="w-full" disabled={loading} type="submit">
              {loading ? "Working..." : mode === "login" ? "Log In" : "Create Account"}
            </Button>
          </form>

          <div className="mt-4 text-sm">
            {mode === "login" ? (
              <button
                className="text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
                onClick={() => {
                  setMsg(null);
                  setMode("signup");
                }}
              >
                Need an account? Sign up
              </button>
            ) : (
              <button
                className="text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
                onClick={() => {
                  setMsg(null);
                  setMode("login");
                }}
              >
                Already have an account? Log in
              </button>
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center p-6">
          <div className="w-full max-w-md">
            <SectionCard
              eyebrow="Access"
              title="Atlas"
              description="Loading sign-in..."
            >
              <div className="text-sm text-muted-foreground/82">Preparing your session.</div>
            </SectionCard>
            <p className="text-sm text-gray-600">Loading sign-in…</p>
          </div>
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}
