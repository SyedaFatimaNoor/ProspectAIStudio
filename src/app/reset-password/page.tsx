"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, KeyRound, LockKeyhole, Mail } from "lucide-react";
import { browserSupabase } from "@/lib/browser-supabase";
import { Button } from "@/components/ui/button";
import { Field, Notice, Spinner } from "@/components/shared";

type Step = "request" | "update";

export default function ResetPassword() {
  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const db = browserSupabase();
    if (!db) return;
    void db.auth.getUser().then(({ data }) => {
      if (data.user) setStep("update");
    });
  }, []);

  async function requestReset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const db = browserSupabase();
      if (!db)
        throw new Error(
          "Authentication is not configured. Add the public Supabase URL and publishable key on the server.",
        );
      const callback = new URL("/auth/callback", window.location.origin);
      callback.searchParams.set("next", "/reset-password");
      const { error: resetError } = await db.auth.resetPasswordForEmail(
        email.trim(),
        { redirectTo: callback.toString() },
      );
      if (resetError) throw resetError;
      // Preserve Supabase's account-enumeration protection.
      setMessage(
        "If an account exists for this address, password-reset instructions have been sent. Check your inbox and spam folder.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to request a password reset. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function updatePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (password.length < 12)
        throw new Error("Use at least 12 characters for your new password.");
      if (password !== confirmation) throw new Error("The passwords do not match.");
      const db = browserSupabase();
      if (!db) throw new Error("Authentication is not configured.");
      const { error: updateError } = await db.auth.updateUser({ password });
      if (updateError) throw updateError;
      await db.auth.signOut();
      setPassword("");
      setConfirmation("");
      setStep("request");
      setMessage("Password updated. You can now sign in with your new password.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to update your password. Please request a new link and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  const isUpdate = step === "update";
  return (
    <main className="auth-page">
      <section className="auth-story">
        <Link href="/" className="brand">
          <span className="brand-symbol">
            <KeyRound size={26} />
          </span>
          Prospect<span className="brand-ai">AI</span>.
        </Link>
        <div className="auth-story-content">
          <div className="hero-label">ACCOUNT RECOVERY</div>
          <h1>
            Keep your workspace.
            <br />
            Keep moving.
          </h1>
          <p>
            Reset links are single-use and handled by Supabase.
            <br />
            We never see or store your password.
          </p>
        </div>
        <span className="auth-privacy">
          <LockKeyhole size={15} />
          Your workspace. Your data. Protected by design.
        </span>
      </section>
      <section className="auth-form-wrap">
        <Link href="/sign-in" className="auth-back">
          <ArrowLeft size={16} />
          Back to sign in
        </Link>
        <form
          onSubmit={isUpdate ? updatePassword : requestReset}
          className="auth-form"
        >
          <span className="auth-icon">
            {isUpdate ? <LockKeyhole size={28} /> : <Mail size={28} />}
          </span>
          <h1>{isUpdate ? "Choose a new password" : "Reset your password"}</h1>
          <p>
            {isUpdate
              ? "Use a new, unique password with at least 12 characters."
              : "Enter your email and we’ll send a secure recovery link if an account exists."}
          </p>
          <div className="form-stack">
            {isUpdate ? (
              <>
                <Field label="New password" hint="Use at least 12 characters.">
                  <input
                    required
                    autoComplete="new-password"
                    type="password"
                    minLength={12}
                    maxLength={200}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter a new password"
                  />
                </Field>
                <Field label="Confirm new password">
                  <input
                    required
                    autoComplete="new-password"
                    type="password"
                    minLength={12}
                    maxLength={200}
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    placeholder="Enter it again"
                  />
                </Field>
              </>
            ) : (
              <Field label="Email address">
                <input
                  required
                  autoComplete="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@yourbusiness.com"
                />
              </Field>
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
              {isUpdate ? "Save new password" : "Send reset instructions"}
              <ArrowRight size={16} />
            </Button>
          </div>
        </form>
        <div className="auth-form-footer">
          <LockKeyhole size={13} />
          Secure authentication powered by Supabase
        </div>
      </section>
    </main>
  );
}
