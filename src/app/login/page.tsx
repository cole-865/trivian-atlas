"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function LoginPage() {
  const supabase = supabaseBrowser();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

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
        window.location.href = "/";
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;

        setMsg("Account created. If email confirmation is enabled, check your inbox. Then log in.");
        setMode("login");
      }
    } catch (err: any) {
      setMsg(err.message ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border p-6 shadow-sm">
        <h1 className="text-2xl font-semibold mb-2">Trivian Atlas</h1>
        <p className="text-sm text-gray-600 mb-6">
          {mode === "login" ? "Log in to continue." : "Create an account."}
        </p>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Email</label>
            <input
              className="mt-1 w-full rounded-md border px-3 py-2"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Password</label>
            <input
              className="mt-1 w-full rounded-md border px-3 py-2"
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

          {msg && <div className="text-sm text-red-600">{msg}</div>}

          <button
            className="w-full rounded-md bg-black text-white py-2 disabled:opacity-50"
            disabled={loading}
            type="submit"
          >
            {loading ? "Working..." : mode === "login" ? "Log In" : "Create Account"}
          </button>
        </form>

        <div className="mt-4 text-sm">
          {mode === "login" ? (
            <button
              className="underline"
              onClick={() => {
                setMsg(null);
                setMode("signup");
              }}
            >
              Need an account? Sign up
            </button>
          ) : (
            <button
              className="underline"
              onClick={() => {
                setMsg(null);
                setMode("login");
              }}
            >
              Already have an account? Log in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}