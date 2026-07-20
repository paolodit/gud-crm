"use client";

import { CheckCircle2, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";

import { authClient } from "@/lib/auth-client";

export function ResetPasswordForm() {
  const search = useSearchParams();
  const token = search.get("token");
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(token ? null : "This reset link is missing its token.");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password"));
    const confirmation = String(form.get("confirmation"));
    if (password !== confirmation) return setError("The passwords do not match.");
    setPending(true);
    setError(null);
    const result = await authClient.resetPassword({ newPassword: password, token });
    setPending(false);
    if (result.error) return setError(result.error.message ?? "Password could not be reset.");
    setComplete(true);
  }

  if (complete) return <div className="auth-form"><CheckCircle2 size={34} color="#00a86b" /><h2>Password updated</h2><p>Your other sessions have been revoked. Sign in with the new password.</p><Link className="btn btn-primary" href="/sign-in">Return to sign in</Link></div>;
  return <form className="auth-form" onSubmit={submit}><div className="brand-mark">G</div><h2>Choose a new password</h2><p>Use at least 12 characters and avoid a password used anywhere else.</p><div className="form-stack"><label className="field-label">New password<input className="field" name="password" type="password" minLength={12} maxLength={128} required autoComplete="new-password" /></label><label className="field-label">Confirm password<input className="field" name="confirmation" type="password" minLength={12} maxLength={128} required autoComplete="new-password" /></label>{error ? <div className="auth-error" role="alert">{error}</div> : null}<button className="btn btn-primary" type="submit" disabled={pending || !token}>{pending ? <LoaderCircle size={16} className="spin" /> : null}Reset password</button><Link className="auth-link-button" href="/sign-in">Back to sign in</Link></div></form>;
}
