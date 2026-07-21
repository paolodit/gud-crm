# Deploying GUD CRM on CapRover

GUD ships one Docker image for every sales model. Deploy that image as one stateless CapRover app per private organisation and give every app its own PostgreSQL database, authentication secret, hostname and backup stream.

The root [`captain-definition`](../captain-definition) points CapRover at the production Dockerfile. The image builds the Next.js standalone runtime, bundles only the migration and first-run bootstrap utilities it needs, applies committed migrations before starting, and exposes a database-aware Docker health check at `/api/health`.

## Recommended topology

```text
focused-sales.example.com  -> GUD app A -> PostgreSQL database A
service-sales.example.com  -> GUD app B -> PostgreSQL database B
```

One PostgreSQL server is sufficient for a small VPS, provided each application has a different database and database user. Do not point two GUD apps at one database. Keep PostgreSQL private and connect through its internal `srv-captain--<postgres-app>:5432` hostname.

## 1. Prepare PostgreSQL

Create one persistent PostgreSQL CapRover app. Attach persistent storage at `/var/lib/postgresql/data`; do not expose port 5432 publicly. Within that server create:

- a database and login role for the focused instance;
- a different database and login role for the service instance.

Each role should own only its own database. Generate different long random passwords and keep them in CapRover environment variables or its secret mechanism, never in this repository or a local shell-history file.

CapRover's own configuration backup excludes persistent volumes. Schedule an encrypted `pg_dump --format=custom` for each database, copy the completed dumps off the VPS, retain several restore points and test a restore into an isolated database.

## 2. Create the two application services

Create two normal CapRover apps. Do **not** enable the app-level persistent-data checkbox: the Node containers are stateless in the current release, which lets CapRover use start-first deployments. Set container port `3000`, attach a different domain to each app, enable Let's Encrypt and force HTTPS.

Deploy this same repository and `captain-definition` to both applications. Building once in CI and reusing the identical image is preferable when the deployment pipeline supports it; building twice from Git also works on a sufficiently sized VPS.

## 3. Configure runtime variables

Set these separately on each application:

| Variable | Focused instance | Service instance |
| --- | --- | --- |
| `NODE_ENV` | `production` | `production` |
| `DATA_BACKEND` | `postgres` | `postgres` |
| `DATABASE_URL` | Focused database URL | Service database URL |
| `GUD_DEFAULT_MODEL` | `focused` | `service` |
| `GUD_INSTANCE_NAME` | Private workspace label | Private workspace label |
| `BETTER_AUTH_SECRET` | Unique 32+ character random value | Different random value |
| `BETTER_AUTH_URL` | Canonical HTTPS URL | Canonical HTTPS URL |
| `NEXT_PUBLIC_APP_URL` | Same canonical HTTPS URL | Same canonical HTTPS URL |
| `AI_PROVIDER` | `local` initially | `local` initially |
| `AI_ENABLED` | `true` | `true` |

`BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` must have exactly the same HTTPS origin. Use URL-encoded database passwords in `DATABASE_URL`. Optional OpenAI, Hunter, Norbert, Companies House, Google Maps and Resend credentials remain server-only and should be added only when the corresponding feature is ready.

Keep actual domains, database URLs, administrator addresses and secrets in CapRover. If a local deployment worksheet is useful, name it `config/caprover.local.*`; that pattern is ignored by Git.

## 4. Bootstrap a new workspace

For the first deployment only, add:

```dotenv
GUD_BOOTSTRAP=if-empty
SEED_ORGANISATION_NAME=Your private workspace name
SEED_ADMIN_NAME=Initial administrator
SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_PASSWORD=a-unique-temporary-password-of-12+-characters
```

Replace every placeholder before deploying. The sample email is deliberately invalid for live bootstrap: the startup guard rejects reserved example addresses and passwords shorter than 12 characters so documented values cannot silently become a live administrator account.

The startup sequence is:

1. apply all committed PostgreSQL migrations;
2. create the organisation, clean model-specific pipeline and administrator only when the database is not already ready;
3. start Next.js;
4. pass `/api/health` only after the application can query PostgreSQL.

The `if-empty` bootstrap is restart-safe: once the administrator, pipeline, stages, activity types and default offer exist, it skips without modifying them. After the first successful sign-in, set `GUD_BOOTSTRAP=off`, remove `SEED_ADMIN_PASSWORD` and redeploy. Change the temporary password from the application.

Never set `SEED_ALLOW_EXISTING=true` in CapRover. That variable exists for deliberate development fixture refreshes, not live startup.

## 5. Understand upgrades and rollbacks

Every container start runs the committed Drizzle migrations before it starts the web server. A migration failure stops the new container instead of serving an application against the wrong schema. The app container remains stateless, so CapRover can wait for its Docker health check before routing traffic.

Database migrations must remain backward-compatible with the previous application image during a start-first rollout. Before every deployment:

1. take a fresh database backup;
2. deploy to a staging database first;
3. verify health and sign-in;
4. deploy the same image to the private production instance;
5. confirm `/api/health`, sign-in and one read/write workflow.

A code rollback does not reverse a database migration. Restore into an isolated database first; never overwrite the only live copy under pressure.

## 6. Data cutover

Do not manually retype a private CRM or copy a SQLite file into PostgreSQL storage. Generate a guarded, transaction-wrapped promotion script from the local database instead:

```powershell
npm run db:promote:sql -- `
  --source data/your-private-instance.db `
  --output data/promotions/your-instance.sql `
  --admin-email you@your-company.example `
  --organisation-name "Your sales workspace" `
  --confirm-private-export
```

Both paths must remain under the ignored `data/` directory. The command first makes an online SQLite safety backup, then writes the SQL and a manifest containing its SHA-256 checksum and expected source counts. The export contains private CRM data: never add it to Git, CI artifacts, Docker build contexts or CapRover logs.

Deploy the application once with `GUD_BOOTSTRAP=if-empty` before importing. That creates the PostgreSQL schema, base workspace and administrator. Apply the generated SQL while connected directly to the new instance database with pgAdmin or `psql`. The script refuses to run when the bootstrap workspace is missing or the target already contains opportunities, and the transaction rolls back on any error.

After import, compare the script's final count result with its adjacent `.manifest.json`, inspect several companies, contacts, activities and next actions in the application, and take a PostgreSQL backup. Then set `GUD_BOOTSTRAP=off`, remove `SEED_ADMIN_PASSWORD` and redeploy.

## 7. Launch checklist

- PostgreSQL is private, persistent and independently backed up.
- Each app has its own database user, database, auth secret and HTTPS origin.
- App-level persistent data is disabled until authenticated uploads are implemented.
- `GUD_BOOTSTRAP` is back to `off` and the temporary password variable is removed.
- `/api/health` returns `status: ok`, `mode: postgres`, `database: connected`.
- Administrator sign-in, sign-out and password recovery have been tested.
- AI and enrichment providers are disabled or configured with project-level spend/quota controls.
- A staging restore and the local-data promotion reconciliation have passed.

Official references: [captain-definition and Dockerfiles](https://caprover.com/docs/captain-definition-file.html), [zero-downtime health checks](https://caprover.com/docs/zero-downtime.html), [persistent applications](https://caprover.com/docs/persistent-apps.html), [application configuration](https://caprover.com/docs/app-configuration.html), and [backup limitations](https://caprover.com/docs/backup-and-restore.html).
