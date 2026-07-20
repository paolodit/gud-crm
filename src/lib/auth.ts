import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth/minimal";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins";

import { db } from "@/db";
import { authSchema } from "@/db/schema";
import { env } from "@/lib/env";

export const auth = betterAuth({
  appName: "GUD CRM",
  baseURL: env.BETTER_AUTH_URL ?? env.NEXT_PUBLIC_APP_URL,
  secret: env.authSecret,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: authSchema,
    usePlural: true,
  }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: env.authEmailConfigured
      ? async ({ user, url }) => {
          void sendPasswordResetEmail(user.email, user.name, url).catch((error) => {
            console.error("Password reset email delivery failed.", error);
          });
        }
      : undefined,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  rateLimit: {
    enabled: env.postgresMode,
    window: 60,
    max: 60,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/request-password-reset": { window: 300, max: 3 },
    },
  },
  user: {
    additionalFields: {
      organisationId: {
        type: "string",
        required: false,
        input: false,
      },
      active: {
        type: "boolean",
        required: false,
        defaultValue: true,
        input: false,
      },
    },
  },
  trustedOrigins: [env.NEXT_PUBLIC_APP_URL],
  advanced: {
    useSecureCookies: env.authUsesHttps && env.postgresMode,
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      secure: env.authUsesHttps && env.postgresMode,
    },
  },
  plugins: [admin({ defaultRole: "member", adminRoles: ["admin"] }), nextCookies()],
});

async function sendPasswordResetEmail(email: string, name: string, url: string) {
  if (!env.RESEND_API_KEY || !env.AUTH_FROM_EMAIL) return;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.AUTH_FROM_EMAIL,
      to: [email],
      subject: "Reset your GUD CRM password",
      text: `Hi ${name},\n\nUse this link to reset your GUD CRM password:\n${url}\n\nIf you did not request this, you can ignore this email.`,
    }),
  });
  if (!response.ok) throw new Error(`Password reset email failed with status ${response.status}.`);
}
