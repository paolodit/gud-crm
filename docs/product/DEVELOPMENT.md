# Development environments

GUD uses one repository and one application for every sales model and private instance.

## The four data contexts

| Context | Sales model | Data | Git status |
| --- | --- | --- | --- |
| Focused private instance | Focused Sales | One organisation's real product/SaaS pipeline | Separate ignored database and secrets |
| Service private instance | Service Sales | One organisation's real multi-service pipeline | Separate ignored database and secrets |
| Focused public demo | Focused Sales | Fictional single-product opportunities | Fixture code committed to Git |
| Service public demo | Service Sales | Fictional website, retainer and visitor-experience opportunities | Fixture code committed to Git |

The first two are deployments of the same application, not forks. They never share a database. The second two are reset-on-refresh views of fictional fixture code and never read either private database.

## Local development

SQLite is the default. It is fast, persistent and does not require Docker:

```bash
npm install
npm run dev
```

`GUD_DEFAULT_MODEL` selects the fixture in demo mode and is read when a new persistent workspace is created. Existing databases keep their saved model and all records.

A new persistent workspace starts clean. Public sample records are available only through the explicit demo commands:

```bash
npm run demo:focused
npm run demo:service
```

## Run several private instances

Copy `config/instances.example.json` to `config/instances.local.json`. The local file is ignored by Git. Give every instance a different database and port, then run:

```bash
npm run dev:instance -- product
npm run dev:instance -- agency
```

Each configuration entry contains only local runtime routing:

- `label`: shown in the navigation so the active instance is unmistakable;
- `model`: `focused` or `service`;
- `database`: an ignored SQLite path;
- `port`: a unique local port.

Never point two instances at the same database. Never commit `instances.local.json`, SQLite files, trackers, exports, uploads, API keys or production environment files.

`run-instance.mjs` enforces a database beneath the ignored `data/` directory and rejects duplicate database paths or ports. A local reset requires `--confirm-reset` and creates an online safety backup before clearing a workspace.

## Automated testing

- Unit and domain tests use Vitest.
- TypeScript and ESLint guard input and component contracts.
- The dependency audit blocks unexpected advisories.
- Authentication smoke tests run against PostgreSQL in GitHub Actions.
- Browser tests use a dedicated disposable SQLite database and fictional records.

## Staging and production

Use separate PostgreSQL databases for staging and for every currently supported internet-facing organisation. The same Docker image can serve each environment with different secrets, instance labels and workspace configuration. SQLite has ample capacity for a small CRM, but the present SQLite runtime is intentionally one trusted session rather than multi-user authentication; see `docs/VPS-DEPLOYMENT.md`.

The production container applies committed migrations before starting Next.js. A new empty database can be deliberately bootstrapped once with `GUD_BOOTSTRAP=if-empty`; remove the temporary administrator password and return the flag to `off` after the first successful sign-in. The full two-instance CapRover procedure, including health checks, rollback constraints and backups, is in `docs/CAPROVER.md`.

Release flow:

1. branch from current `origin/main`;
2. run the complete local quality suite;
3. open a draft pull request;
4. let GitHub exercise the bundled production migration/bootstrap path and PostgreSQL authentication;
5. deploy to staging and run the browser journey;
6. merge and deploy the same image to production;
7. verify health, sign-in and a backup after deployment.
