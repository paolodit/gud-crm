# Security posture

This document records the implemented controls and known limits. It is an engineering security review, not a substitute for an independent penetration test before handling high-risk or regulated data.

## Runtime boundary

- SQLite and demo modes intentionally bypass individual login. They are for trusted local development and must not be internet-facing.
- This is an authentication limitation, not a SQLite capacity limitation. A future SQLite team mode must add persisted users/sessions, production cookie/origin checks, role tests and off-host backup/restore verification before this boundary changes.
- PostgreSQL mode requires a database URL and a 32+ character auth secret.
- A production PostgreSQL runtime requires matching canonical application/auth origins and HTTPS, except for explicit localhost smoke testing.
- Docker Compose refuses missing database, auth and public URL secrets rather than falling back to example credentials.
- The production container applies committed migrations before accepting traffic. Migration failure stops startup, preventing the application from serving against an incompatible schema.
- First-run bootstrap is disabled by default. `GUD_BOOTSTRAP=if-empty` requires a non-placeholder administrator email and a 12+ character password, becomes a no-op once the workspace is complete, and should be returned to `off` with the temporary password removed after initial sign-in.

## Authentication and access

- Better Auth provides scrypt password hashing, origin/CSRF checks, HTTP-only same-site cookies and revocable database sessions.
- Passwords are 12-128 characters. Public sign-up is disabled.
- Sign-in is limited to five attempts per minute per source; password-reset requests are limited to three per five minutes.
- Password reset is exposed only when a verified server-side email sender is configured, and a successful reset revokes existing sessions.
- Every CRM mutation resolves the current member server-side. PostgreSQL reads and writes are scoped to the member's organisation.
- Admin-only and manager-only actions enforce roles in the server action, not just in the interface.

## XSS, injection and unsafe links

- React renders CRM text as text; the application does not use `dangerouslySetInnerHTML`, `innerHTML`, `eval` or dynamic code execution.
- Every manually entered, researched or tracker-imported external link is restricted to HTTP or HTTPS. `javascript:`, `data:` and file URLs are rejected, and displayed external links are checked again.
- Content Security Policy, frame blocking, MIME sniff protection, referrer, opener/resource and permissions headers provide defence in depth. The production CSP blocks `eval`; development alone permits it for React debugging. Next.js currently requires inline bootstrap scripts, so the CSP allows inline script/style execution; a nonce-based CSP is a worthwhile future hardening step.
- Drizzle ORM queries are parameterised. Local SQLite statements use placeholders. No user-provided value is concatenated into SQL.
- Zod schemas bound identifiers, text lengths, arrays, URLs, email addresses, dates and enumerations before writes.
- Activity logging verifies that a supplied contact is linked to the selected opportunity and organisation, closing a cross-record IDOR edge.
- Server actions preserve short intentional validation messages but replace database, provider and multiline internal failures with bounded public errors; detail stays in server logs.

## Data and outbound services

- Database, auth, OpenAI, Hunter, Norbert and email credentials remain server-side.
- Research enrichment is one named contact at a time, honours do-not-contact state and records provenance.
- AI context is bounded, outputs are schema-validated and nothing is automatically sent or scheduled.
- Health responses expose runtime/database state but no record counts, file paths or credentials.
- Backups contain personal data and must be encrypted, access-controlled and kept out of email and Git.

## Dependency audit

Run:

```powershell
npm run security:audit
```

The July 2026 review removed the deployable PostCSS XSS advisory by overriding Next.js's transitive PostCSS to `8.5.19`. There are no known high or critical advisories and no remaining known runtime advisory.

One moderate development-only advisory is explicitly accepted: Drizzle Kit includes `@esbuild-kit/esm-loader`, which carries esbuild `0.18.20`. The advisory concerns exposing esbuild's development server to a hostile website. GUD does not invoke that server, Drizzle Kit is a development dependency, and the production image copies only the built standalone runtime. The audit script fails on any advisory outside this exact chain. Revisit the exception when Drizzle Kit removes the deprecated loader.

## Verification

GitHub Actions runs dependency audit, strict TypeScript, ESLint, unit/contract tests, the production build and a real PostgreSQL authentication smoke test. The smoke test proves:

1. an unauthenticated workspace request is redirected;
2. email/password sign-in issues a session;
3. the session resolves to the expected user;
4. the authenticated Today page renders; and
5. sign-out removes access.

Run the same flow against a running PostgreSQL deployment with:

```powershell
$env:AUTH_SMOKE_URL="https://crm.example.com"
$env:AUTH_SMOKE_EMAIL="dedicated-test-user@example.com"
$env:AUTH_SMOKE_PASSWORD="..."
npm run auth:smoke
```

Use a dedicated low-privilege test account and pass secrets through the environment, never command history committed to the repository.

## Known limits and next hardening steps

- Complete an independent application penetration test before a public launch with real customer data.
- Add a nonce-based CSP if Next.js deployment constraints permit it.
- Add automated dependency update pull requests and secret scanning in the GitHub repository settings.
- Add authenticated, authorised, size-limited and malware-scanned attachment routes before exposing uploads.
- Add privacy export/deletion and retention automation before scaling personal-data volume.
- Confirm reverse-proxy IP header sanitisation so auth rate limiting cannot be bypassed with forged forwarded headers.
