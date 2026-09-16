# One release, three existing GUD instances

Use this process for **Demo → Refresh → HSM**. These are three configurations of the same application, not three builds or three databases to recreate.

```sh
npm run release:plan
npm run release:all -- --ref <full-commit-sha>
```

`release:plan` works on a developer computer and does not contact production. `release:all` runs on the trusted **single-node Linux CapRover manager**, from a clean checkout of that commit. It requires Node 24, Git and Docker; no global CapRover CLI is needed. The runner uses Node built-ins and the repository's safety helper, so it does not require `npm ci` on the host. Dependencies are installed inside the image build.

The tooling is implemented in this repository. **Live activation still requires the one-time runner, private registry, tokens and backup destinations below.** Adding these files does not enable deployments on Git push, create a privileged public webhook, or install a server service.

## What one rollout does

1. Resolve one committed Git revision. Uncommitted changes, local databases and private configuration are not packaged. The runner must itself match the selected commit.
2. Acquire a shared release lock. Check all three existing app services, separate PostgreSQL identities, separate authentication secrets, HTTPS origins and persistent database mounts. Refuse bootstrap/seeding, SQLite, empty databases, unsupported topology or changed migration history.
3. Read a baseline of existing record identifiers, including direct projects and delivery checklist IDs stored in JSON. Identifiers are hashed inside the application container; record content, credentials and identifiers are not written into the release journal.
4. Build/test **one image** and publish it to the configured private registry. The guarded Docker build runs lint, unit tests, release safety tests and the production build. If this exact guarded image already exists locally, reuse it. Pin its immutable registry digest for all three deployments. Publish a named rollback tag/digest for each instance's previous image as well.
5. Make a fresh, full custom-format `pg_dump` of **each** database, including the `drizzle` migration schema. Verify archive structure with `pg_restore --list`, write SHA-256 checksums, and verify a second backup copy. **All three backups must succeed before any app deployment begins.**
6. Deploy the same image through CapRover's app-token API: Demo first, then Refresh, then HSM. This request changes the image only; it does not submit replacement environment settings, volumes, database services or domains.
7. Before the new server starts, acquire a PostgreSQL advisory lock and apply only pending migrations. The lock and transaction use the same connection. Repeated/overlapping starts cannot race the migration ledger.
8. Require three consecutive successful checks of the **new commit's** public health endpoint and Docker container health/image ID. Recheck migration history, configuration and retention of pre-existing record IDs before advancing.
9. Save a private release journal with image IDs, rollback tags, backup paths/checksums, record counts and per-instance outcome. Keep backups and images. Nothing is pruned by rollout.

The three apps are **not an atomic transaction**. If Demo succeeds and Refresh fails, Demo may be on the new version while HSM remains untouched. The journal shows precisely where execution stopped. No automated restore or database downgrade is attempted.

## One-time server setup

### Guided setup (recommended for the existing manager)

The backup mount is a prerequisite; this setup never edits `/etc/fstab`, installs packages, restarts applications or deploys code.

Have the three app-specific CapRover deployment tokens and a private-registry push token ready. For GitHub Container Registry, create a **classic** personal access token with `write:packages` (not `repo` or `delete:packages`). A newly pushed GHCR package starts private; do not change it to public or link it to a public repository with inherited access. Give CapRover a separate `read:packages` token in **Cluster → Docker Registry**, server `ghcr.io`, your GitHub username and that read-only token. Token creation and registry access are operator actions, not performed by the setup script.

From the clean server checkout, run:

```sh
export PATH="/opt/gud-node-24/bin:$PATH"
npm run release:setup
```

The interactive script checks the existing three service configurations, asks for the mounted off-host destination and private registry, creates private directories, validates each app token using an empty-source POST, signs Docker into the registry through `--password-stdin`, and saves `/etc/gud-release/rollout.json` as root-only (0600). The validation submits no image or source: it expects the authenticated missing-source error that CapRover returns **before** scheduling a deployment. Unexpected responses fail closed. Password/token prompts accept pasting and show only masked characters. It refuses to overwrite existing settings. Docker credentials are kept separately in `/etc/gud-release/docker`, not in the checkout or shell history.

CapRover app tokens **cannot authenticate GET build-status requests**. They are scoped to the deployment POST route. See the upstream [authorization route](https://github.com/caprover/caprover/blob/v1.13.3/src/routes/user/UserRouter.ts) and [missing-source guard](https://github.com/caprover/caprover/blob/v1.13.3/src/routes/user/apps/appdata/AppDataRouter.ts). The runner therefore requires an interactive confirmation that CapRover has no queued/running builds and no other operator will deploy during the release. Docker update-state checks reject incomplete/failed updates, but cannot see CapRover's in-memory queue. This is an operator-assisted gate, **not an automatic queue-status check**; no administrator credential is collected to bypass that limitation. A detached deployment acknowledgement (`101`) only means queued/accepted; image, revision, database and health verification still determine success.

The rollout command then loads those settings automatically:

```sh
npm run release:all -- --ref <full-commit-sha>
```

No repeated environment exports or token entry are needed. A conflicting shell override stops the command instead of silently selecting another destination. Keep Node 24 on `PATH` in future SSH sessions (or invoke `/opt/gud-node-24/bin/node scripts/release-all.mjs apply --ref <full-commit-sha>` directly). Registry pull access in CapRover, clean committed source, passing CI and a successful first full rollout must still be verified; setup alone does not prove deploy readiness.

### Manual setup / other existing infrastructure

Use a trusted operator account on the existing CapRover manager. Docker access is effectively host-administrator access: do not expose this command as an unauthenticated webhook or run untrusted pull requests on this machine. Multi-node swarms and externally hosted PostgreSQL intentionally fail preflight; they require a remote backup adapter before using this process.

1. Create one **app-specific deployment token** in CapRover for each existing app: `gud-demo`, `gud-refresh`, `gud-hsm`. Do not use or save the captain/root password.
2. Ensure all three apps use their existing `DATA_BACKEND=postgres` and `DATABASE_URL`, with `GUD_BOOTSTRAP=off`. Remove obsolete seed passwords. `SEED_ALLOW_EXISTING` and `SEED_IF_EMPTY` must not be true. The runner does not change these settings for you.
3. Leave runtime `GUD_BUILD_REVISION` and `GUD_RELEASE_GUARDED` unset in CapRover: these values are baked into each image. Keep each instance's existing auth secret, sales model, AI/provider keys, hostname, database and mounts.
4. Prepare three **distinct, non-nested, private directories (0700)** outside the source checkout: release state, primary database backups, and a second backup destination. All invocations must use the same state directory/lock. Mount the second destination on separate/off-host storage. The script verifies a second file and checksum, **not the storage provider's disaster independence**.
5. Keep the runner environment in an operator-owned file outside Git (0600). Load it in the operator's shell before running the command. Do not paste secret values into command arguments or chat.
6. Provision/select a **private container registry repository** (an existing private registry or private GHCR package is suitable). Configure the runner's Docker credential store with push access, and CapRover's registry connection with pull access. Keep credentials out of these scripts; use the registry's normal secure login flow. Set `GUD_RELEASE_IMAGE_REPOSITORY` to the full repository path. CapRover's image API pulls from a registry, so a local-only image tag is deliberately not used for deployment. Both application and rollback images must remain private and available.

Example environment names (paths and values must be configured by the operator):

```dotenv
GUD_DEPLOY_TOKEN_DEMO=<app-specific-token>
GUD_DEPLOY_TOKEN_REFRESH=<app-specific-token>
GUD_DEPLOY_TOKEN_HSM=<app-specific-token>
GUD_RELEASE_IMAGE_REPOSITORY=registry.example.com/gud-crm
GUD_RELEASE_STATE_DIR=/var/lib/gud-releases
GUD_RELEASE_BACKUP_DIR=/var/backups/gud-releases
GUD_RELEASE_BACKUP_COPY_DIR=/mnt/private-offsite/gud-releases
```

The non-secret target list, local build-cache image name and CapRover origin are in [`config/rollout.json`](../config/rollout.json). Public application origins and database credentials are read from each existing Docker service, not copied into source code. The dump client runs in its existing PostgreSQL container, so no host port needs opening. Dumps exclude role ownership/ACL recreation; keep existing database roles and include CapRover configuration in separate infrastructure backups. The tool cannot verify your registry's visibility policy: the operator must configure it as private before first use.

## Normal release checklist

1. Review and commit the intended changes; keep unrelated local research/data out of the commit. Push the commit through the normal Git workflow. This command does **not** auto-commit or push a dirty developer workspace.
2. Wait for the repository's quality checks, including browser tests and the disposable PostgreSQL upgrade test, to pass for that commit. The runner repeats build/unit checks, but does not query GitHub check status or run browser/PostgreSQL integration tests inside the image build.
3. Fetch/check out that exact commit in the server's release checkout, load the private runner environment, then run `npm run release:plan` followed by `npm run release:all -- --ref <full-commit-sha>`. Check the CapRover dashboard for queued/running builds and answer the runner's quiet-window confirmation; unattended invocation intentionally fails closed.
4. Use a quiet operational window. A legitimate user deletion during deployment can trigger the retained-ID safeguard; investigate it rather than automatically restoring a backup over newer work.
5. Confirm the journal reports all three targets `verified`. Spot-check sign-in, Pipeline, Live projects and the feature being released.

Avoid simultaneous manual CapRover deployments or settings changes. Configuration/image changes detected between preflight and rollout stop the command. A deployment failure or uncertain API response retains the lock for operator review. Interrupting the process may also leave the lock: verify no release process or CapRover deployment is active, inspect the journal, then remove only that stale `rollout.lock`. Never blindly clear it as part of a retry.

## Migration policy and data retention

- **Refresh and HSM data stays in place.** No demo seed, `db:push`, SQL promotion/import, database reset, volume replacement or database restore is part of the rollout. Demo data is preserved too.
- Commit generated SQL and its Drizzle journal together. Never edit an already applied migration. Exact hashes/timestamps must match the applied prefix. Preserve SQL bytes across platforms (do not renormalise old migration files).
- Routine guarded releases accept a conservative set of additive DDL: new tables/types/indexes, added columns/constraints and added enum values. Data rewrites, renames, drops, arbitrary procedural SQL and other statements stop for a **separately reviewed maintenance release**. There is no `--force` bypass in the rollout command.
- The gate is a conservative review aid, not proof that arbitrary SQL/default expressions are safe or backwards-compatible. Review every migration for compatibility with the still-running old app. Use expand/contract changes across releases for eventual removals.
- Runtime starts can tolerate a newer schema if all migrations known to that image match. This permits a deliberately selected previous image to start against a newer **compatible additive** schema, without running down migrations. The forward rollout command remains strict and rejects a commit older than the database's history.
- Retention checks cover primary-key records and nested project/task IDs; ephemeral sessions, verifications, access tokens and AI rate-limit buckets are excluded from the ID comparison. Backups still include these tables and all full record contents. ID checks do not prove every column is unchanged; the backups and additive-only policy provide complementary safeguards.
- Do not repeat historical one-off imports such as Refresh's delivery-notes-to-tasks migration. Those are not part of application deployment.

## If a release fails

First inspect the private release journal and CapRover deployment/app logs. The command does not log database URLs, tokens or record contents. Driver errors are deliberately summarised; detailed investigation should stay in a private operator session.

For an application-only regression, select that target's recorded `rollbackImage` in CapRover's image deployment option, **after checking compatibility with the now-current schema**. Keep the database and runtime configuration unchanged. Confirm Docker health and the previous revision's `/api/health`. Earlier pre-metadata images may not report a revision. Do not change or erase the migration ledger just to make an older image start.

Database restore is disaster recovery, not ordinary rollback. Stop writes, preserve a backup of the current state, restore the chosen full archive into a **separate recovery database**, verify both application and migration schemas, and reconcile any newer writes before an explicitly approved cutover. Never run an automatic `pg_restore --clean` against Refresh or HSM.

`pg_restore --list` verifies archive readability/contents, **not a complete recovery rehearsal**. Regularly test restoring the copied backup to an isolated database. CapRover's own configuration backup does not include application database volumes. See [CapRover backup limitations](https://caprover.com/docs/backup-and-restore.html) and [PostgreSQL archive/restore documentation](https://www.postgresql.org/docs/17/app-pgrestore.html).

## Verification and housekeeping

- `npm run test:release`: offline orchestration/failure-path tests; no live infrastructure access.
- `npm test`: includes migration-history, additive-policy and rollback-compatibility tests.
- `npm run build:runtime-tools`: bundles the production migration/entrypoint utilities.
- `npm run test:release:postgres`: requires an **empty disposable** database supplied via `GUD_RELEASE_TEST_DATABASE_URL`, whose name ends `_release_test`. It tests upgrade from the previous migration set, overlapping/repeated starts, record retention and transactional failure. CI provisions its own disposable database; the test never resets an existing one.

Backups include private CRM and Thoughts content, so restrict/encrypt their storage and access. Capacity monitoring and retention/pruning are intentionally separate from release. Never prune current images, rollback tags, database volumes or the only verified backup in an attempt to get a release through.
