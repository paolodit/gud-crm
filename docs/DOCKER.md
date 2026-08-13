# Run GUD CRM with Docker

This guide creates one authenticated GUD CRM workspace with a PostgreSQL database. It is suitable for a production-like local test or a small server behind an HTTPS reverse proxy.

For a trusted, single-user local workspace, `npm run dev` with SQLite is faster and simpler. Do not expose SQLite or demo mode to the public internet.

## What is included

| File or command | Purpose |
| --- | --- |
| [`Dockerfile`](../Dockerfile) | Multi-stage Node 24 production image, non-root runtime and health check |
| [`docker-compose.yml`](../docker-compose.yml) | GUD plus PostgreSQL 17 with persistent named volumes |
| `npm run deploy:secrets` | Generates an auth secret, database password and temporary administrator password |
| `npm run deploy:check -- --env .env` | Validates the deployment shape without printing secret values |
| `npm run db:postgres:backup` | Creates checksummed custom-format PostgreSQL backups with retention |

## 1. Prepare the environment

Clone the repository and copy the public example:

```bash
git clone https://github.com/paolodit/gud-crm.git
cd gud-crm
cp .env.example .env
npm ci
npm run deploy:secrets
```

Save the generated values in a password manager. Edit `.env` and set at least:

```dotenv
DATA_BACKEND=postgres
POSTGRES_PASSWORD=replace-with-the-generated-database-password
APP_URL=https://crm.example.com
BETTER_AUTH_SECRET=replace-with-the-generated-auth-secret
GUD_DEFAULT_MODEL=service
GUD_INSTANCE_NAME=Your sales workspace

GUD_BOOTSTRAP=if-empty
SEED_ORGANISATION_NAME=Your sales workspace
SEED_ADMIN_NAME=Your name
SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_PASSWORD=replace-with-the-generated-temporary-password
```

`APP_URL` must be the final HTTPS origin. Use `focused` or `service` for `GUD_DEFAULT_MODEL`. Replace the reserved example address with the real administrator email, and do not leave placeholder secrets in a live environment.

Check the file before starting:

```bash
npm run deploy:check -- --env .env
```

The checker reports variable names and remediation only. It does not print passwords, keys or database URLs.

## 2. Start the stack

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f app
```

The first healthy app start applies committed migrations and creates the administrator only because `GUD_BOOTSTRAP=if-empty` was set. Open the configured HTTPS URL through your reverse proxy and sign in.

The container listens on port `3000`. Terminate TLS in Caddy, Traefik, nginx or another reverse proxy; do not publish an unauthenticated HTTP deployment to the internet.

Verify health:

```bash
curl -fsS https://crm.example.com/api/health
```

A ready team deployment reports `status: ok`, `mode: postgres` and `database: connected`.

## 3. Close first-boot access

After the first successful sign-in:

1. change the temporary password in GUD;
2. set `GUD_BOOTSTRAP=off` in `.env`;
3. remove `SEED_ADMIN_PASSWORD` from `.env`;
4. apply the environment change with `docker compose up -d`;
5. verify sign-in and `/api/health` again.

The database lives in the `postgres_data` volume, not in the application image. Rebuilding or replacing the app container does not erase that volume. This is not a backup: make database dumps and copy them off the server.

## Updates

Take a fresh backup first, then update the exact code revision and rebuild:

```bash
git fetch --all --prune
git switch main
git pull --ff-only
docker compose build --pull app
docker compose up -d
docker compose ps
```

The application applies forward migrations before starting. A migration failure leaves the new container unhealthy rather than serving against an incompatible schema.

## Backups

The included backup helper requires a compatible `pg_dump` binary and a trusted destination:

```bash
DATABASE_URL=postgresql://gud:...@db:5432/gud_crm \
GUD_BACKUP_DIR=/mnt/encrypted-backups/gud-crm \
GUD_BACKUP_RETENTION=21 \
npm run db:postgres:backup
```

It creates a custom-format dump, an SHA-256 sidecar and removes only older backups for the same database. Schedule it, copy completed backups off the host and test restoration into a separate database.

## Multiple private workspaces

Run a separate GUD app and separate database for each organisation. They may share one PostgreSQL server, but each must use a distinct database, database role, auth secret, hostname and backup stream. Never point two GUD apps at the same database.

For managed VPS deployment, domains and start-first releases, see the [CapRover guide](CAPROVER.md). For day-two work, see [Operations](OPERATIONS.md).
