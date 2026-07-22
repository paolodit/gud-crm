import { CheckCircle2 } from "lucide-react";

import { SignInForm } from "@/components/sign-in-form";
import { BrandLogo } from "@/components/brand-logo";
import { env } from "@/lib/env";

// The storage/auth mode is runtime configuration. CapRover builds one image
// that is reused by differently configured instances, so this page must not
// capture the build machine's SQLite defaults during static generation.
export const dynamic = "force-dynamic";

export default function SignInPage() {
  return (
    <main className="auth-page">
      <section className="auth-visual" aria-label="Product introduction">
        <div className="brand">
          <BrandLogo size={56} priority />
          <div className="brand-copy">
            <strong>GUD CRM</strong>
            <span>Good outreach, clearly owned</span>
          </div>
        </div>
        <div className="auth-message">
          <h1>Know what happened. Know what’s next.</h1>
          <p>A bright, focused workspace for thoughtful sales outreach—built around real conversations, clear ownership, and the next useful action.</p>
        </div>
        <div className="auth-points">
          <span><CheckCircle2 size={15} /> Shared history</span>
          <span><CheckCircle2 size={15} /> Owned next actions</span>
          <span><CheckCircle2 size={15} /> Human review first</span>
        </div>
      </section>
      <section className="auth-form-wrap">
        <SignInForm demoMode={env.demoMode} localMode={env.sqliteMode} passwordResetEnabled={env.postgresMode && env.authEmailConfigured} />
      </section>
    </main>
  );
}
