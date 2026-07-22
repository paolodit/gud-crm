# VPS deployment and database choices

GUD can serve several private workspaces from one codebase. Each organisation is a separate deployment with its own database, secrets, uploads, hostname and backups. Do not put two organisations in one SQLite file and do not build organisation-specific branches.

## The short answer on SQLite

SQLite has more than enough storage and read performance for a lightly used sales CRM. [SQLite's official guidance](https://www.sqlite.org/whentouse.html) describes the application-server pattern as an appropriate use: browsers talk to one server, and that server owns the database file. GUD also enables [write-ahead logging](https://www.sqlite.org/wal.html), so readers do not normally block one another while the short writes are serialised.

The current blocker is GUD's login implementation, not database capacity. Today:

| Runtime | Good for | Internet-facing team use |
| --- | --- | --- |
| `demo` | Local fictional showcase | No in the current deployment profile; it has no accounts |
| `sqlite` | Trusted local/private development and one-person use | No; it deliberately opens one trusted admin session |
| `postgres` | A real team with individual accounts and roles | Yes; this is the supported live runtime |

So a small VPS does not inherently need PostgreSQL, but **this release does need PostgreSQL when real users sign in over the internet**. Avoid hiding that distinction behind a reverse-proxy password: GUD would still record everyone as one local admin and could not revoke or attribute individual sessions correctly.

## Two private instances on one VPS

Run the same image twice:

```text
focused-sales.example.com  -> GUD app A -> database A -> backups A
service-sales.example.com  -> GUD app B -> database B -> backups B
```

Give each deployment its own:

- hostname and canonical HTTPS URL;
- database and database credentials;
- `BETTER_AUTH_SECRET`;
- `GUD_INSTANCE_NAME` and `GUD_DEFAULT_MODEL`;
- upload volume and provider/API keys;
- encrypted backup schedule and tested restore path.

Real organisation names and records belong only in private deployment settings and databases. The public image contains generic models and fictional fixtures.

For the complete CapRover configuration, automatic migration/bootstrap behaviour, health checks and launch checklist, see [Deploying GUD CRM on CapRover](CAPROVER.md).

## What a supported SQLite Live mode requires

SQLite Live is a sensible future option for one small organisation on one VPS. It should ship only after all of these are implemented and tested:

1. Better Auth users, sessions, reset tokens and organisation membership persisted in SQLite.
2. The same server-side role and organisation checks used by PostgreSQL.
3. HTTPS-only production cookies, canonical-origin checks, sign-in throttling and password recovery.
4. Exactly one application replica with the database on local persistent block storage. [WAL databases must not be shared between hosts over a network filesystem](https://www.sqlite.org/wal.html#overview).
5. Automated online backups copied off the VPS, retention, encryption and a recurring restore test.
6. A health check that verifies the writable database and a documented migration path to PostgreSQL if write contention or deployment topology grows.

The existing Download SQLite backup and reset safety backup already use [SQLite's online backup mechanism](https://www.sqlite.org/backup.html). A VPS job should call the same mechanism, then copy the completed snapshot off-host; it should not copy only the main file while WAL writes are active.

## Recommendation for the two real workspaces

Continue shaping real focused-sales and service-sales workspaces as ignored local SQLite instances. This keeps development quick and their data out of Git. For an internet-facing team deployment, use separate PostgreSQL databases (or separate databases on one managed PostgreSQL server) because secure individual login is already implemented and exercised by CI. If avoiding PostgreSQL is strategically important, build SQLite Live authentication as a contained follow-up rather than weakening the current security boundary.
