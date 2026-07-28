"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { BrandLogo } from "@/components/brand-logo";

export function SignInForm({ demoMode, localMode, passwordResetEnabled }: { demoMode: boolean; localMode: boolean; passwordResetEnabled: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetMode, setResetMode] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const form = new FormData(event.currentTarget);
    if (resetMode) {
      const result = await authClient.requestPasswordReset({ email: String(form.get("email")), redirectTo: `${window.location.origin}/reset-password` });
      setPending(false);
      if (result.error) return setError(result.error.message ?? "Reset email could not be requested.");
      setMessage("If that address has an account, a reset link is on its way.");
      return;
    }
    const result = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
      rememberMe: true,
    });

    if (result.error) {
      setError(result.error.message ?? "Sign-in failed.");
      setPending(false);
      return;
    }

    router.push("/pipeline");
    router.refresh();
  }

  if (demoMode) {
    return (
      <div className="auth-form">
        <BrandLogo size={68} priority />
        <h2>Explore the working CRM</h2>
        <p>The workspace is currently running in demo mode with representative tracker data.</p>
        <button className="btn btn-primary" style={{ width: "100%" }} onClick={() => router.push("/pipeline")}>
          Open demo workspace <ArrowRight size={16} />
        </button>
        <p style={{ marginTop: 16 }}>
          Add <code>DATABASE_URL</code> and the auth secrets from <code>.env.example</code> to switch on persistent multi-user mode.
        </p>
      </div>
    );
  }

  if (localMode) {
    return (
      <div className="auth-form">
        <BrandLogo size={68} priority />
        <h2>Local development workspace</h2>
        <p>SQLite runs as one trusted admin session for fast development. Team roles are stored, but separate passwords and resets intentionally begin when the app moves to PostgreSQL.</p>
        <button className="btn btn-primary" style={{ width: "100%" }} onClick={() => router.push("/pipeline")}>Open local workspace <ArrowRight size={16} /></button>
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <BrandLogo size={68} priority />
      <h2>{resetMode ? "Reset your password" : "Welcome back"}</h2>
      <p>{resetMode ? "We’ll email a secure, time-limited reset link." : "Sign in to see the whole pipeline, then focus on what needs attention."}</p>
      <div className="form-stack">
        <label className="field-label">
          Work email
          <input className="field" name="email" type="email" autoComplete="email" required />
        </label>
        {!resetMode ? <label className="field-label">
          Password
          <input className="field" name="password" type="password" autoComplete="current-password" required minLength={12} maxLength={128} />
        </label> : null}
        {error ? <div className="auth-error" role="alert">{error}</div> : null}
        {message ? <div className="auth-success" role="status">{message}</div> : null}
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? <LoaderCircle size={16} className="animate-spin" /> : null}
          {resetMode ? "Send reset link" : "Sign in"}
        </button>
        {passwordResetEnabled ? <button className="auth-link-button" type="button" onClick={() => { setResetMode((value) => !value); setError(null); setMessage(null); }}>{resetMode ? "Back to sign in" : "Forgot password?"}</button> : null}
      </div>
    </form>
  );
}
