<p align="center">
  <img src="https://raw.githubusercontent.com/paolodit/gud-crm/main/public/gud-crm-logo.png" width="128" alt="GUD CRM logo" />
</p>

<h1 align="center">GUD CRM</h1>

<p align="center"><strong>A focused workspace to win the work and keep delivery moving.</strong></p>

<p align="center">
  Understand the opportunity. Keep the relationship clear. Know the next move.
</p>

<p align="center">
  Made with care by <a href="https://www.refreshcreative.com">Refresh</a>.
</p>

## Watch GUD CRM in action

[![Watch the GUD CRM video walkthrough](https://img.youtube.com/vi/HaV0UPhr-kQ/hqdefault.jpg)](https://youtu.be/HaV0UPhr-kQ)

**[Watch the short video walkthrough →](https://youtu.be/HaV0UPhr-kQ)**

GUD CRM is for small sales teams, agencies, consultancies, SaaS companies and independent specialists who want useful sales discipline without traditional CRM sprawl.

It keeps ideas, targets and live opportunities distinct; makes the whole pipeline readable at a glance; and gives every active relationship an owner, context and a next action. AI supports optional research and voice-to-fields input, never an automatic salesperson. Video guides replace the former Sales Guide and in-app coaching panel with a small curated YouTube library.

## Why GUD feels different

- **The pipeline is the home screen.** Spread a busy stage across three lanes. Edit a card, talk through an update or change its stage directly from the board; dragging is optional.
- **Research stays out of live sales.** Explore market ideas separately, build named targets before outreach, then promote only credible opportunities.
- **One product or several services.** Focused Sales suits a single product or SaaS motion. Service Sales suits agencies and consultancies pitching different projects, retainers and advisory work.
- **Say it, review it, save it.** Talk to GUD combines record changes, an activity and a next action in one review. Edit or untick each change, apply together, and Undo safely. No CRM record is changed until you confirm.
- **Delivery has its own home.** Won opportunities appear on Live projects automatically—or add an existing project without a sales cycle. Configure delivery stages, expand busy columns, track milestones and archive completed work independently of sales. [How it works](docs/LIVE-PROJECTS.md).
- **Relationships remain human-readable.** Companies, contacts, evidence, activities, tasks, value and decision context stay connected.
- **Finished records leave without disappearing.** Archive an opportunity or a whole organisation to remove it from active work while preserving its stage, contacts, activity and next actions; restore it at any time.
- **AI is bounded and reviewable.** Draft outreach, explore angles, prepare research and ask for a next move without auto-sending anything.
- **Your existing AI workspace can connect.** The optional MCP endpoint gives authorised Codex, ChatGPT and compatible clients an at-a-glance sales brief, sourced research and bounded CRM updates through a narrow, auditable tool surface. [Connect it in a few minutes](docs/MCP.md#the-five-minute-path).
- **Free enrichment goes further.** Optional Hunter and Voila Norbert integrations use a visible, free-first provider order for one-contact-at-a-time email discovery.

Live projects is deliberately lightweight: a delivery overview linked to the sales relationship, not an invoicing system, project scheduler or support desk.

## Choose your sales model

| Model | Best for | What changes |
| --- | --- | --- |
| **Focused Sales** | One product, SaaS offer or closely related product family | A single clear offer and a direct target-to-pipeline motion |
| **Service Sales** | Agencies, consultancies and specialists | Multiple offers, project types and market ideas without duplicating the CRM |

Both models use the same application and data model. A workspace can be configured without maintaining a separate codebase.

## Try it in two minutes

Requirements: [Node.js 24](https://nodejs.org/) and npm.

```bash
git clone https://github.com/paolodit/gud-crm.git
cd gud-crm
npm ci
npm run demo:service
```

Open [http://localhost:3201](http://localhost:3201). The demo contains fictional records, needs no login and resets when restarted.

For the single-product journey instead:

```bash
npm run demo:focused
```

Open [http://localhost:3200](http://localhost:3200).

## Start a persistent local workspace

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and choose **Open local workspace**. GUD creates a persistent SQLite database at `data/gud-crm.db`; `data/` is ignored by Git.

SQLite mode is deliberately a trusted local workspace without individual user authentication. It is excellent for development and personal evaluation, but it must not be exposed directly to the internet.

Useful local commands:

```bash
npm run db:local:status
npm run db:local:backup
npm run db:local:export
```

See [Getting started](docs/GETTING-STARTED.md) for the first useful setup session and [Sales models](docs/product/EDITIONS.md) for the model differences.

## Run it for a team

Live multi-user workspaces use PostgreSQL, Better Auth and HTTPS. Every organisation should have its own database, database user, authentication secret and hostname.

| Route | Use it when | Guide and tooling |
| --- | --- | --- |
| **Render + Neon** | You want the easiest free personal/evaluation deployment and accept sleep/wake delays | [`render.yaml`](render.yaml), [free-hosting guide](docs/FREE-HOSTING.md) |
| **Docker Compose** | You control a Linux server or want a production-like local stack | [`docker-compose.yml`](docker-compose.yml), [`Dockerfile`](Dockerfile), [Docker guide](docs/DOCKER.md) |
| **CapRover** | You want simple app deployment, domains and TLS on a VPS | [`captain-definition`](captain-definition), [CapRover guide](docs/CAPROVER.md) |

The quickest hosted trial uses a free Render web service and a separate Neon PostgreSQL database:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2Fpaolodit%2Fgud-crm)

Create the Neon database first, then the button asks for its connection string and your initial administrator details. Render supplies the public HTTPS origin automatically. Free services sleep, can start slowly and are not a substitute for a backed-up production host; the [free-hosting guide](docs/FREE-HOSTING.md) makes those limits explicit.

The production image:

- builds the Next.js standalone server on Node 24;
- runs committed PostgreSQL migrations before the web server starts;
- bootstraps a new workspace only when explicitly enabled;
- runs as a non-root user;
- exposes a database-aware health check at `/api/health`;
- keeps application containers stateless so database backups and deployments remain separate concerns.

Generate strong first-install secrets:

```bash
npm run deploy:secrets
```

Validate a private deployment environment without printing secret values:

```bash
npm run deploy:check -- --env .env
```

Then follow either the [Docker](docs/DOCKER.md) or [CapRover](docs/CAPROVER.md) walkthrough. Do not use the sample values unchanged.

## Data safety

The public repository contains application code and fictional demo fixtures only. Real CRM records, imports, SQLite databases, deployment worksheets, uploads, API keys and environment files are ignored and checked by the privacy audit.

Before every live deployment:

1. create and verify a fresh PostgreSQL backup;
2. deploy the same tested commit or image to each instance;
3. confirm `/api/health` reports a connected PostgreSQL database;
4. test sign-in and one read/write workflow;
5. keep the previous image available for application rollback.

A code rollback does not undo a database migration. Restore testing belongs in an isolated database, never over the only live copy.

Read [Operations and backups](docs/OPERATIONS.md), [VPS deployment](docs/VPS-DEPLOYMENT.md) and the [Security guide](docs/SECURITY.md) before inviting a live team.

## Optional AI, MCP and enrichment

All three integrations are off or local-first by default:

- Voice-to-fields requires `AI_ENABLED=true`, `AI_PROVIDER=openai` and a server-side `OPENAI_API_KEY`. Voice controls link directly to Settings → AI connections when that connection is missing. Early installations using `OPEN_API_KEY` remain compatible, but `OPENAI_API_KEY` is the canonical name. The in-app sales coaching controls have been removed; existing historical AI records are retained.
- Remote MCP access is available only in authenticated PostgreSQL mode and must be enabled with `MCP_ENABLED=true`. Follow the [ChatGPT, Codex and MCP setup guide](docs/MCP.md) for the supported read/write actions, consent model and example requests.
- Hunter and Voila Norbert keys can be connected by an administrator and are encrypted server-side. GUD never puts provider keys in browser code.

Nothing is auto-sent, auto-scheduled or silently promoted into the pipeline. External research is treated as untrusted evidence and remains subject to human review.

### Shared voice updates

- **Talk to GUD** is available throughout the workspace, including through `Ctrl/⌘ + Shift + Space`. Existing opportunity and live-project update buttons open the same review. Choose one record explicitly when outside a record, or when a client has both sales and delivery records.
- Sales updates can change stage, estimate, priority and temperature, log an activity, and create a CRM next action. Sales-linked live projects support delivery changes plus the shared activity/task timeline. Direct projects use delivery notes and their next milestone instead. New-record voice forms remain available before a record exists.
- Review only shows proposed changes. Each can be corrected or excluded. Missing next-action dates/times must be supplied; times are interpreted in the browser's IANA timezone, with ambiguous clock-change times rejected. No emails, calendar invitations or other external messages are sent.
- Browser speech recognition is optional and may use the browser vendor's speech service; typing works too. Capture starts only on a click. The editable transcript stays in this browser tab for up to 24 hours and is cleared on sign-out. Only the transcript, selected record name/title and reference options are sent to the configured OpenAI model when requesting a review (`store: false`), not the record's contacts or history.
- Prepared reviews and applied/undone receipts are retained in the existing workspace audit store; raw transcripts are not journalled. A prepared review lasts 30 minutes. Apply is transactional and idempotent across SQLite and PostgreSQL. Interrupted responses can be recovered by reopening voice; retries cannot duplicate a saved update.
- The receipt offers **Undo for 15 minutes**, including after reload in the same tab. Undo reverses only that update and refuses if affected fields, its new activity, or its new task have changed. Unrelated newer work is preserved. No database migration is required.
- Run `node scripts/run-voice-e2e.mjs` for browser tests with an isolated SQLite database, loopback AI fixture and synthetic speech events. They cover review, correction, combined saves, missing times, interrupted-save recovery, mobile layout and Undo. Real microphone permissions and the configured live provider still need an environment smoke check.

### Curated video guides

- `/playbook` remains the stable route, now labelled **Video guides**. No database migration is needed.
- Curate entries in `src/lib/video-guides.ts`: verified YouTube ID, original title, speaker, publisher, topic and a short editorial reason to watch. The seven entries were checked against YouTube oEmbed on 10 September 2026.
- Thumbnails are served through Next.js image optimisation, restricted to `i.ytimg.com/vi/`. A fallback is shown if an image fails. No YouTube player or script is loaded into the CRM; videos open on YouTube in a separate tab.
- Search and topic filters run locally. The library needs no YouTube API key and sends no CRM records to YouTube. Check video availability periodically when maintaining the list.

### Live project values

Live projects support an optional agreed **Project value (£)**, stored as `delivery.projectValue` for both sales-linked and direct projects. It is separate from the original opportunity's sales estimate and does not change sales totals. Existing projects remain unset until a value is entered. Zero is valid; clearing the input stores `null`. Values support two decimal places and are shown on board cards. This uses existing JSON storage, with no database migration.

Delivery voice capture can prepare an explicitly stated total GBP project value for review before saving. Omitted values do not clear existing amounts; budgets, costs, deposits, monthly rates and foreign currencies must not be treated as agreed GBP totals.

### Connect an AI assistant to your GUD

Every installed GUD workspace exposes its own endpoint at `https://your-gud-domain.example/mcp`. Add that URL as a separate OAuth app in ChatGPT, Codex or another compatible MCP client and request these scopes:

```text
gud:read
gud:write
```

One connection belongs to one GUD domain and database. If you run production, a second business workspace and a demo, create three clearly named connections; they use the same GUD code but cannot see one another's records. No custom source files are needed for each instance—only its own domain, PostgreSQL database, environment variables and user accounts.

Colleagues can connect the same endpoint with their own GUD login and approve their own revocable access. On managed ChatGPT workspaces, an administrator may also need to make the app and its write actions available to the member's role. See [MCP connections: multiple instances and teams](docs/MCP.md#multiple-gud-instances-and-teams) for setup, sharing and upgrade guidance.

Configuration examples live in [`.env.example`](.env.example). The fuller contracts are documented in [Security](docs/SECURITY.md) and the [CapRover MCP section](docs/CAPROVER.md#3-configure-runtime-variables).

## Development

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
npm run privacy:audit
npm run security:audit
```

The CI workflow repeats the quality, privacy, dependency, PostgreSQL migration and authentication checks on every pull request.

Repository map:

```text
src/app/                 Next.js routes and server actions
src/components/          CRM interface and workflows
src/lib/                 Auth, data access, AI, MCP and integrations
src/db/                  Schema, migrations and fixtures
scripts/                 Backups, imports, deployment and test helpers
docs/                    Setup, operations, security and product contracts
public/                  Public brand assets
```

Before proposing a change, run the quality commands above and keep the interface purposeful, data-safe and useful at first glance. Review the [security posture](docs/SECURITY.md) before working on authentication, data access or external integrations.

## Documentation

- [Getting started](docs/GETTING-STARTED.md)
- [Live projects and voice updates](docs/LIVE-PROJECTS.md)
- [Connect an AI coworker with MCP](docs/MCP.md)
- [Free hosting with Render and Neon](docs/FREE-HOSTING.md)
- [Docker installation](docs/DOCKER.md)
- [CapRover installation](docs/CAPROVER.md)
- [Operations and backups](docs/OPERATIONS.md)
- [Security model](docs/SECURITY.md)
- [Public-release privacy checklist](docs/PUBLIC-RELEASE.md)
- [Product charter](docs/product/PRODUCT-CHARTER.md)
- [Sales models](docs/product/EDITIONS.md)

## Licence

GUD CRM is released under the [MIT Licence](LICENSE).
