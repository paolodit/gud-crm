# Deploying GUD CRM on CapRover

GUD ships one Docker image for every sales model. Deploy that image as one stateless CapRover app per private organisation and give every app its own PostgreSQL database, authentication secret, hostname and backup stream.

## The shortest safe install

If you already have CapRover and PostgreSQL, a clean first instance is five deliberate steps:

1. Run `npm run deploy:secrets`, save the three values in a password manager, then create a database and login role used only by this GUD instance.
2. Create a normal CapRover app, set **Container HTTP Port** to `3000`, and leave app-level persistence off.
3. Add the variables from the minimal block below, using fresh generated secrets.
4. Deploy the repository tarball or Git source using the included `captain-definition`.
5. Sign in, confirm `/api/health`, then set `GUD_BOOTSTRAP=off`, remove the seed password and restart.

The repository already includes everything CapRover needs:

| File or command | Purpose |
| --- | --- |
| [`captain-definition`](../captain-definition) | Tells CapRover to build the production Dockerfile |
| [`Dockerfile`](../Dockerfile) | Node 24 standalone build, non-root runtime and health check |
| `npm run deploy:secrets` | Generates strong first-install secrets without writing them to disk |
| `npm run deploy:check -- --env config/caprover.local.my-app.env` | Checks a private deployment worksheet without printing its values |
| `npm run db:postgres:backup` | Creates checksummed database dumps with retention |

Files matching `config/caprover.local.*` are ignored by Git. They are optional private worksheets for preflight checking; CapRover environment variables remain the live source of truth.

Minimal first-boot environment:

```dotenv
DATA_BACKEND=postgres
DATABASE_URL=postgresql://INSTANCE_USER:URL_ENCODED_PASSWORD@srv-captain--POSTGRES_APP:5432/INSTANCE_DATABASE?sslmode=disable
GUD_DEFAULT_MODEL=service
GUD_INSTANCE_NAME=Your sales workspace
BETTER_AUTH_SECRET=GENERATE_AT_LEAST_32_RANDOM_CHARACTERS
BETTER_AUTH_URL=https://crm.example.com
NEXT_PUBLIC_APP_URL=https://crm.example.com
GUD_BOOTSTRAP=if-empty
SEED_ORGANISATION_NAME=Your sales workspace
SEED_ADMIN_NAME=Your name
SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_PASSWORD=GENERATE_A_UNIQUE_12_PLUS_CHARACTER_PASSWORD
AI_ENABLED=true
AI_PROVIDER=local
MCP_ENABLED=false
```

Then connect the domain, enable HTTPS and **Force HTTPS**. Do not leave the container port at CapRover's default `80`: the GUD image listens on `3000`.

`npm run deploy:secrets` only prints fresh random values. It does not create a file, alter the database or send anything over the network. Use the generated PostgreSQL password when creating the role, URL-encode it in `DATABASE_URL`, and remove `SEED_ADMIN_PASSWORD` from CapRover after the first successful sign-in.

Before entering values in the dashboard, you can copy the minimal block into an ignored `config/caprover.local.my-app.env`, replace every value, and run:

```bash
npm run deploy:check -- --env config/caprover.local.my-app.env
```

The preflight reports names and corrective actions only. It never prints the database URL, passwords or API keys.

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

For a manual deployment from a clean, committed branch, install and authenticate the CapRover CLI, then select the server and app:

```bash
npm install --global caprover
caprover login
caprover deploy --caproverName your-server --caproverApp your-app --branch main
```

CapRover packages committed files from the selected branch; ignored private data and uncommitted changes are not sent. App-specific deployment tokens are safer than a server-wide password for automated delivery.

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
| `MCP_ENABLED` | `true` to allow AI coworker connections | `true` to allow AI coworker connections |
| `AI_PROVIDER` | `local` initially | `local` initially |
| `AI_ENABLED` | `true` | `true` |
| `AI_MODEL` | Model name when using OpenAI | Model name when using OpenAI |
| `OPENAI_API_KEY` | Optional server-side project key | Optional server-side project key |

`BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` must have exactly the same HTTPS origin. Use URL-encoded database passwords in `DATABASE_URL`. Optional OpenAI, Hunter, Norbert, Companies House, Google Maps and Resend credentials remain server-only and should be added only when the corresponding feature is ready. Older GUD installs that used `OPEN_API_KEY` are recognised for compatibility; rename it to the canonical `OPENAI_API_KEY` when convenient.

`MCP_ENABLED` is deliberately off unless set to `true`. Enable it only after the canonical HTTPS domain and migrations are healthy. Settings then shows the instance-specific `/mcp` endpoint that each user can connect to once with their own GUD login and revocable OAuth grant.

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

### Guarded in-app update control

Settings can expose **Back up & update** without giving the browser a CapRover password. Configure two private, server-side webhook URLs:

```text
GUD_VERSION=release-or-commit-label
GUD_BACKUP_WEBHOOK_URL=https://private-automation.example/backup/gud-instance
GUD_DEPLOY_WEBHOOK_URL=https://private-automation.example/deploy/gud-instance
```

The backup hook receives a POST request and must return a successful HTTP status only after a fresh database dump is complete and copied to the intended backup destination. GUD then calls the deployment hook. Keep both webhook tokens out of Git and out of `NEXT_PUBLIC_*` variables. Use an app-specific CapRover deployment webhook or a narrowly scoped release service, never the CapRover root password.

Until both hooks exist, the update button remains disabled. This is intentional: a one-click deployment without a verified backup is not a safe upgrade.

### PostgreSQL backup helper

The repository includes `npm run db:postgres:backup`. Run it from a trusted VPS backup job or utility container that has a compatible `pg_dump` binary:

```text
DATABASE_URL=postgresql://.../gud_instance
GUD_BACKUP_DIR=/encrypted/offsite-mounted/gud-instance
GUD_BACKUP_RETENTION=21
npm run db:postgres:backup
```

It writes a custom-format dump atomically, adds a SHA-256 sidecar and prunes only older dumps for the same database. Replicate that destination off the VPS. Schedule and test every private instance separately; never reuse one database URL for both jobs.

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

## Docker Compose alternative

For a single server without CapRover:

```bash
cp .env.example .env
# edit .env: set POSTGRES_PASSWORD, APP_URL, BETTER_AUTH_SECRET and first-boot admin values
docker compose up -d --build
docker compose ps
curl -fsS https://crm.example.com/api/health
```

The committed Compose file creates a persistent PostgreSQL volume and exposes GUD on host port `3000`. Put an HTTPS reverse proxy in front of it. After the first sign-in, change `GUD_BOOTSTRAP` to `off`, remove `SEED_ADMIN_PASSWORD`, and run `docker compose up -d` again. Back up the PostgreSQL volume with `pg_dump`; a container image rebuild does not contain your database.

Official references: [captain-definition and Dockerfiles](https://caprover.com/docs/captain-definition-file.html), [zero-downtime health checks](https://caprover.com/docs/zero-downtime.html), [persistent applications](https://caprover.com/docs/persistent-apps.html), [application configuration](https://caprover.com/docs/app-configuration.html), and [backup limitations](https://caprover.com/docs/backup-and-restore.html).
