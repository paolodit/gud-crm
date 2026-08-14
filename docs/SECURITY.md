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

### Remote MCP access

- Remote MCP is disabled by default and is available only when `MCP_ENABLED=true` on a PostgreSQL deployment.
- Better Auth provides OAuth 2.1 authorization-code flow with S256 PKCE, one-hour access tokens, renewable refresh tokens and dynamic public-client registration.
- MCP access resolves the token's user against the current active GUD user and organisation before constructing any tool.
- `gud:read` and `gud:write` are separate scopes. Read-only is the default; write tools activate only when the user has explicitly approved a stored `gud:write` consent grant, even if a client requests a broader token.
- Tool inputs are bounded with Zod, writes are allowlisted and every MCP mutation creates an audit event attributed to the connected GUD user.
- The endpoint exposes no delete tool, no arbitrary SQL or generic record patch. Won/Lost moves require an explicit confirmation flag after user confirmation.
- Research tools accept only HTTP(S) evidence URLs, never initiate outreach and leave newly discovered targets in Researching for human review.
- The endpoint validates the canonical forwarded host, sends no-store responses and exposes only the CORS headers required by remote MCP clients.
- OAuth application, consent and token records stay in the instance database. Database backups therefore contain connector grants and require the same encryption and access controls as CRM data.

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
- Workspace-specific FreeMax keys are encrypted at rest with AES-256-GCM using a deployment-secret-derived key and organisation-bound authenticated data. They are write-only in the UI and deployment environment keys remain optional fallbacks.
- Research enrichment is one named contact at a time, honours do-not-contact state and records provenance.
- AI context is bounded, outputs are schema-validated and nothing is automatically sent or scheduled.
- Voice-assisted forms use the browser's speech-recognition service, then send only its transcript to the configured AI provider for structuring. GUD does not persist raw audio or the transcript unless the user reviews and saves the populated form; the browser or operating-system speech provider may process audio under its own privacy terms.
- Camera, microphone and screen-capture permissions are limited to the app's own origin. This keeps browser recording tools compatible without granting silent access: the browser still requires the user to approve every camera, microphone or screen-sharing permission.
- Health responses expose runtime/database state but no record counts, file paths or credentials.
- Backups contain personal data and must be encrypted, access-controlled and kept out of email and Git.

## Dependency audit

Run:

```powershell
npm run security:audit
```

The July 2026 review removed the deployable PostCSS XSS advisory by overriding Next.js's transitive PostCSS to `8.5.19`, and the runtime is pinned to the patched Next.js `16.2.11`. There are no known high or critical advisories in the production dependency set and no remaining known runtime advisory.

One moderate development-only advisory is explicitly accepted: Drizzle Kit includes `@esbuild-kit/esm-loader`, which carries esbuild `0.18.20`. The advisory concerns exposing esbuild's development server to a hostile website. GUD does not invoke that server, Drizzle Kit is a development dependency, and the production image copies only the built standalone runtime. The audit script fails on any advisory outside this exact chain. Revisit the exception when Drizzle Kit removes the deprecated loader.

One high-severity denial-of-service advisory is also accepted only in the ESLint development toolchain: current ESLint dependencies still resolve older `brace-expansion` majors for their local file-pattern matcher. GUD never accepts user-controlled lint patterns, ESLint and its matcher are absent from the standalone production image, and the audit separately verifies that this exact advisory is absent from `npm audit --omit=dev`. Revisit the exception when ESLint's dependency line moves to the patched matcher.

## Verification

GitHub Actions runs dependency audit, strict TypeScript, ESLint, unit/contract tests, the production build and a real PostgreSQL authentication smoke test. The smoke test proves:

1. an unauthenticated workspace request is redirected;
2. email/password sign-in issues a session;
3. the session resolves to the expected user;
4. the authenticated Pipeline page renders; and
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
