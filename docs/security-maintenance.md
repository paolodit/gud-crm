# October 2026 security maintenance

Containers use Node 24.22.1, Next.js 16.4.3 and Zod 4.6.7 with the committed lockfile.

Better Auth remains on the compatible 1.6.33 line because migrating the MCP integration to the new OAuth provider is a separate application change. These advisories remain visible in npm audit:

- GHSA-965c-763c-88jm requires Magic Link plus social/Generic OAuth login.
- GHSA-r4xp-prcw-77qf requires the OAuth Proxy plugin.
- GHSA-q84f-53jg-9ppm requires device authorization.
- GHSA-44jh-23m7-hpcf concerns database-backed rate-limit storage.

This app enables only admin, MCP and cookie integration plugins, has no social login configuration, and explicitly uses memory rate-limit storage. The audit parses the authentication configuration and rejects added/dynamic plugins, database storage, unknown advisories and dependency-chain findings. Tests exercise the rejected configurations. This is a configuration-based assessment, not a claim that the packages contain no known vulnerabilities. Reassess before adding authentication plugins or scaling rate limiting across processes.

The PostgreSQL production cluster was upgraded to 18.6 after an isolated restore rehearsal and a quiesced fresh copy. All database table counts, owners and locales were checked; the previous volume is retained separately for recovery.
