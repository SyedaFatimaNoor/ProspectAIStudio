"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Orbit,
  ArrowRight,
  ShieldCheck,
  ArrowLeft,
  Mail,
  LockKeyhole,
} from "lucide-react";
import { browserSupabase } from "@/lib/browser-supabase";
import { takeBrowserAuthAttempt } from "@/lib/auth-attempt-limiter";
import { Button } from "@/components/ui/button";
import { Field, Notice, Spinner } from "@/components/shared";
export default function SignIn() {
  const router = useRouter();
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("error") === "callback")
      setMessage(
        "That sign-in or recovery link is invalid or has expired. Request a new password-reset link and try again.",
      );
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const db = browserSupabase();
      if (!db)
        throw new Error(
          "Authentication is not configured. Add the public Supabase URL and publishable key on the server.",
        );
      const attempt = takeBrowserAuthAttempt("credentials", {
        limit: 5,
        windowMs: 5 * 60_000,
      });
      if (!attempt.allowed)
        throw new Error(
          `Too many sign-in or sign-up attempts from this browser. Please wait ${attempt.retryAfterSeconds} seconds before trying again.`,
        );
      if (mode === "signup") {
        const { data, error } = await db.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (error) throw error;
        if (data.session) router.push("/overview");
        else
          setMessage(
            "Check your email to confirm your account, then return to sign in.",
          );
      } else {
        const { error } = await db.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push("/overview");
        router.refresh();
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to sign in. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <div className="auth-story">
        <Link href="/" className="brand">
          <span className="brand-symbol">
            <Orbit size={26} />
          </span>
          Prospect<span className="brand-ai">AI</span>.
        </Link>
        <div className="auth-story-content">
          <div className="hero-label">
            BETTER OPPORTUNITIES. REAL CONNECTIONS.
          </div>
          <h1>
            A little insight.
            <br />A world of potential.
          </h1>
          <p>
            Discover real businesses. Understand the evidence.
            <br />
            Make an introduction that matters.
          </p>
          <img src="/world.svg" alt="Illustration of a connected world" />
        </div>
        <span className="auth-privacy">
          <ShieldCheck size={15} />
          Your workspace. Your data. Protected by design.
        </span>
      </div>
      <main className="auth-form-wrap">
        <Link href="/overview" className="auth-back">
          <ArrowLeft size={16} />
          Explore the workspace
        </Link>
        <form onSubmit={submit} className="auth-form">
          <span className="auth-icon">
            <Orbit size={28} />
          </span>
          <h2>
            {mode === "signin"
              ? "Welcome to your next opportunity."
              : "Make room for better opportunities."}
          </h2>
          <p>
            {mode === "signin"
              ? "Sign in to your ProspectAI workspace."
              : "Create your free ProspectAI account."}
          </p>
          <div className="form-stack">
            <Field label="Email address">
              <input
                required
                autoComplete="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@yourbusiness.com"
              />
            </Field>
            <Field
              label="Password"
              hint={mode === "signup" ? "Use at least 12 characters." : ""}
            >
              <input
                required
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
                type="password"
                minLength={mode === "signup" ? 12 : 1}
                maxLength={200}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
              />
            </Field>
            {mode === "signin" && (
              <Link href="/reset-password" className="auth-recovery-link">
                Forgot your password?
              </Link>
            )}
            {error && (
              <div role="alert">
                <Notice tone="error">{error}</Notice>
              </div>
            )}
            {message && (
              <div role="status">
                <Notice>{message}</Notice>
              </div>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner /> : null}
              {mode === "signin"
                ? "Sign in to workspace"
                : "Create your account"}
              <ArrowRight size={16} />
            </Button>
          </div>
          <div className="auth-mode">
            {mode === "signin"
              ? "New to ProspectAI?"
              : "Already have an account?"}{" "}
            <button
              type="button"
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setError("");
                setMessage("");
              }}
            >
              {mode === "signin" ? "Create an account" : "Sign in"}
            </button>
          </div>
          <p className="auth-terms">
            By continuing, you agree to use public business information
            responsibly and respect recipients’ privacy and preferences.{" "}
            <Link href="/privacy">Privacy &amp; data handling</Link>
            {" · "}
            <Link href="/responsible-use">Responsible use</Link>
          </p>
        </form>
        <div className="auth-form-footer">
          <LockKeyhole size={13} />
          Secure authentication powered by Supabase
        </div>
      </main>
    </div>
  );
}
