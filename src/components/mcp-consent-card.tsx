"use client";

import { Bot, Check, Eye, LoaderCircle, PencilLine, ShieldCheck, X } from "lucide-react";
import { useState } from "react";

import { BrandLogo } from "@/components/brand-logo";

export function McpConsentCard({
  clientName,
  consentCode,
  scopes,
  userName,
}: {
  clientName: string;
  consentCode: string;
  scopes: string[];
  userName: string;
}) {
  const [pending, setPending] = useState<"accept" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canWrite = scopes.includes("gud:write");

  async function decide(accept: boolean) {
    setPending(accept ? "accept" : "deny");
    setError(null);
    try {
      const response = await fetch("/api/auth/oauth2/consent", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept, consent_code: consentCode }),
      });
      const result = await response.json() as { redirectURI?: string; message?: string };
      if (!response.ok || !result.redirectURI) throw new Error(result.message || "The connection could not be completed.");
      window.location.assign(result.redirectURI);
    } catch (cause) {
      setPending(null);
      setError(cause instanceof Error ? cause.message : "The connection could not be completed.");
    }
  }

  return (
    <main className="mcp-consent-page">
      <section className="mcp-consent-card">
        <header>
          <BrandLogo size={48} priority />
          <span><Bot size={22} /></span>
        </header>
        <div className="mcp-consent-copy">
          <span className="eyebrow">AI coworker connection</span>
          <h1>Let {clientName} work with GUD?</h1>
          <p>Signed in as <strong>{userName}</strong>. This connection is limited to your current GUD workspace and can never access the raw database.</p>
        </div>
        <div className="mcp-permission-list">
          <span><Eye size={18} /><span><strong>Read the sales workspace</strong><small>Companies, contacts, pipeline context, tasks and activity history.</small></span><Check size={17} /></span>
          {canWrite ? <span><PencilLine size={18} /><span><strong>Make bounded CRM updates</strong><small>Add research, opportunities, next actions and confirmed activity. No deletes or outreach sending.</small></span><Check size={17} /></span> : null}
          <span><ShieldCheck size={18} /><span><strong>Keep human control</strong><small>Research stays in review, terminal moves need confirmation, and every mutation is audit logged.</small></span><Check size={17} /></span>
        </div>
        {error ? <p className="auth-error" role="alert">{error}</p> : null}
        <footer>
          <button className="btn btn-quiet" type="button" disabled={pending !== null} onClick={() => decide(false)}>{pending === "deny" ? <LoaderCircle className="spin" size={15} /> : <X size={15} />}Deny</button>
          <button className="btn btn-primary" type="button" disabled={pending !== null} onClick={() => decide(true)}>{pending === "accept" ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}Allow {canWrite ? "read & write" : "read-only"} access</button>
        </footer>
        <small className="mcp-consent-note">Access tokens expire after one hour. The client can renew the connection for up to 30 days without asking for your password.</small>
      </section>
    </main>
  );
}
