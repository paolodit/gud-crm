# Development environments

GUD uses one repository and one application for every sales model and private instance.

## Local development

SQLite is the default. It is fast, persistent and does not require Docker:

```bash
npm install
npm run dev
```

`GUD_DEFAULT_MODEL` is read only when a new workspace is created. Existing databases keep their saved model and all records.

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

## Automated testing

- Unit and domain tests use Vitest.
- TypeScript and ESLint guard input and component contracts.
- The dependency audit blocks unexpected advisories.
- Authentication smoke tests run against PostgreSQL in GitHub Actions.
- Browser tests use a dedicated disposable SQLite database and fictional records.

## Staging and production

Use separate PostgreSQL databases for staging and for every live organisation. The same Docker image can serve each environment with different secrets, instance labels and workspace configuration.

Release flow:

1. branch from current `origin/main`;
2. run the complete local quality suite;
3. open a draft pull request;
4. let GitHub exercise PostgreSQL migrations and authentication;
5. deploy to staging and run the browser journey;
6. merge and deploy the same image to production;
7. verify health, sign-in and a backup after deployment.
