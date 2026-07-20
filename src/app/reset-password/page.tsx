import { Suspense } from "react";

import { ResetPasswordForm } from "@/components/reset-password-form";

export default function ResetPasswordPage() {
  return <main className="auth-page auth-page-simple"><section className="auth-form-wrap"><Suspense fallback={null}><ResetPasswordForm /></Suspense></section></main>;
}
