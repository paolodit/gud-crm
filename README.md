<p align="center">
  <img src="./public/gud-crm-logo.png" width="132" alt="GUD CRM logo" />
</p>

<h1 align="center">GUD CRM</h1>

> A calm, fast CRM for teams who care more about the next good conversation than feeding a database.

GUD CRM turns sales research into an operating rhythm: a separate target pool, one visible sales pipeline, clear context about what is being pitched, and one owned next action. It runs locally with persistent SQLite in about two minutes, grows into PostgreSQL on a VPS, and includes an on-demand AI outreach coach that never sends anything for you.

The repository ships two fictional, reset-on-refresh demonstrations: one shows a single-product sales motion and the other shows an agency-style pipeline with several services. No operating company, contact or outreach data belongs in the public tree.

GUD is one **Sales Workspace** with two sales models: **Focused Sales** for a single product, SaaS offer or tightly connected product family, and **Service Sales** for agencies and consultancies pitching several kinds of project or retainer. Both share the same secure CRM core. The product ends at a clean client handoff rather than expanding into project delivery, invoicing or support. See [the product charter](docs/product/PRODUCT-CHARTER.md), [sales models](docs/product/EDITIONS.md), [development environments](docs/product/DEVELOPMENT.md) and the [public-release privacy checklist](docs/PUBLIC-RELEASE.md).

## What is already useful

| Workspace | What you can do |
| --- | --- |
| Ideas | In Service Sales, test market needs and service angles without mixing them into named prospect work. Hand a guarded brief to Codex or Cowork, keep dated evidence, and delete ideas that go nowhere. |
| Targets | Build the organisation, qualification evidence, provisional opportunity and named contact routes before the first touch. Focused Sales starts here; Service Sales can bring targets across from Ideas. |
| Offers | Define the products or services you pitch once. A second active offer quietly unlocks contextual filters, labels, reporting, playbook assets and AI grounding across the CRM. |
| Pipeline | Start with the whole sales picture, drag or keyboard-move opportunities into a deliberate order, spread a busy stage across two lanes, filter by owner/attention, and switch between comfortable and compact cards. |
| Opportunity | Talk or type a new opportunity naturally, then work in a wide relationship workspace with editable company fit/scale, contacts, tasks, outreach rhythm, timeline, logging, and AI together. |
| Activity | Log each attempt, channel and outcome in seconds; optionally create the follow-up in the same move. |
| AI coach | Ask for the best next move, an outreach draft, creative routes, or cold-lead recovery. |
| Today | Focus on five ranked next moves, a compact pipeline pulse and only the relationships that need a decision; expand the full schedule when needed. |
| Companies | Add a company manually, sort by fit/name/contact coverage/pipeline order, then jump into live work. Every manually added company gets a research card so it cannot vanish between lists. |
| Search | Find companies, people, notes, outcomes, roles, and opportunity context. |
| Reports | See pipeline health, stage distribution, workload, channel mix, and attention gaps. |
| Playbook | Navigate a visual outreach loop, multi-channel cadence, guardrails and adaptable patterns; track the readiness, link and owner of six essential sales assets. |
| Settings | Manage the team, roles and offer library; rename the pipeline; inspect backup/update readiness; edit activity types; understand stage semantics; and configure AI. |
| Import | Preview the research tracker, validate all expected columns, detect duplicates, then import it idempotently from Settings or the CLI. |

The design principle is simple: important work should be obvious, updates should be quick, and the system should help a human make a better decision without pretending to be the human.

## See the whole book first

After sign-in, GUD opens **Pipeline**. The first screen answers the broad question—*where does everything stand?*—without forcing the user through a summary layer first. A crowded stage can expand into two lanes while remaining one stage and one colour, so a live book of work stays readable without vertical scrolling. Comfortable and compact card views handle the rest of the density range.

**Today** remains one click away as a deliberate focus layer. It answers three narrower questions:

1. **What should I do next?** Five owned actions are ranked by overdue state, priority, temperature, pipeline progress and date.
2. **Where is the pipeline?** A small pulse shows how many opportunities are ready, in outreach, in a live conversation or in nurture.
3. **What needs a decision?** Records without an owned next step, marked at risk, unresponsive or overdue are surfaced separately.

The complete schedule is one collapsed section below Today. Pipeline is the place to understand and move the whole book of work; Today is the place to choose the next few actions when it is time to focus.

Targets are deliberately outside the sales journey. A possible target remains in the Targets workspace until it has qualification evidence, a usable contact route and a human chooses to start outreach. The active pipeline is intentionally outcome-led:

`Ready to contact → Outreach active → Engaged → Discovery booked → Trial proposed → Trial active → Won`

Three side outcomes stay out of that compulsory journey: **Research holding** keeps market-map, reference, weak-route, paused, or no-fit desk research without pretending it was a sales loss; **Nurture** is only for a real relationship with inactive timing plus a recorded re-entry trigger; **Lost** is reserved for a genuine post-contact commercial loss. Sending an overview or useful diagnostic is an activity, not a pipeline gate; several LinkedIn, email, phone, or physical attempts can live cleanly inside **Outreach active** until a person engages. Every opportunity shows attempt count, channel coverage, latest outcome, activity history, and the next owned action.

The bundled roster is fictional. Admins manage users and workspace controls; managers can import and maintain sales assets; sales support can work opportunities, contacts, activities and tasks but cannot manage team access or workspace settings. Real users and PostgreSQL seed credentials remain environment-controlled.

## One focus, several kinds of work

Offers are the intentionally small abstraction that lets the same CRM handle a website project, retainer, consultancy engagement or specialist product without weakening its focus.

- A new workspace begins with one default offer. In that state, there is no offer filter, no extra badge on every card, and no additional step in the normal workflow.
- An admin adds another offer in **Settings → Offers** with a name, colour, short description, ideal customer and positioning. That is the moment multi-offer controls become visible.
- Research targets may stay unassigned while the team is still deciding what is relevant. Before a target reaches the live pipeline, the offer must be chosen.
- The pipeline, Companies, My work and Reports can focus on one offer or show all. Offer labels appear only in mixed views where the distinction matters.
- One company can have several opportunities for different offers. The existing company/contact and opportunity/contact model keeps those pitches connected to the same relationship without duplicating the company.
- The AI coach receives the selected offer’s description, ideal customer and positioning. It does not blend another service into the draft.
- Each offer has its own six-item sales asset kit in the Playbook. Existing assets migrate to the default offer automatically.
- Offers with history are archived, not deleted. Old activity and reporting retain their meaning.

The pipeline stages remain shared. That is deliberate: one operating language keeps reporting and team habits coherent. Separate stage models should only be introduced later if real usage proves that two sales motions cannot honestly share the same outcomes.

## Start locally in two minutes

Requirements: Node.js 24 LTS and npm. The repository includes `.nvmrc`, `.node-version`, an engine constraint, and a Node 24 Docker image so local, CI, and live runtimes agree.

```powershell
git clone https://github.com/paolodit/gud-crm.git
cd gud-crm
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Choose **Open local workspace** and GUD lands on the Pipeline.

With no environment file, GUD CRM uses SQLite at `data/gud-crm.db`, creates a clean Focused Sales workspace, and keeps changes across refreshes and restarts. Local mode deliberately has no login ceremony; it is intended for trusted development and single-user evaluation.

To explore the public fixtures without creating or changing a database, run either demonstration:

```powershell
npm run demo:focused   # single product / SaaS-style, http://localhost:3200
npm run demo:service   # agency / multi-service, http://localhost:3201
```

Both contain only fictional `DEMO ·` organisations and reset on restart. They can run side by side because each uses a separate development build directory and port.

To run several private instances from this one checkout, copy `config/instances.example.json` to the ignored `config/instances.local.json`, add one entry per workspace, then run `npm run dev:instance -- <name>`. Each entry supplies its own label, sales model, SQLite database and port. The label is shown in the navigation so it is always clear which instance is open.

Useful local data commands:

```powershell
npm run db:local:status                 # counts and database location
npm run db:local:export                 # export a readable JSON backup
npm run db:local:reset -- --confirm-reset  # safety backup, then reset to a clean workspace
```

The `data/` directory is ignored by Git. Do not commit a real CRM database or an export containing personal data.

Settings also has **Download SQLite backup**, which uses SQLite's online backup API to produce a consistent `.sqlite` copy while the app is running. Store it away from the development machine. The CLI reset refuses to continue without an explicit confirmation flag and creates another consistent backup before changing anything. Do not email a database containing contact details.

### Choose a runtime explicitly

Copy `.env.example` to `.env.local` when you want explicit configuration:

```powershell
Copy-Item .env.example .env.local
```

```dotenv
DATA_BACKEND=sqlite          # fastest local development; persistent
SQLITE_PATH=data/gud-crm.db
```

Other supported values are `demo` for a reset-on-refresh showcase and `postgres` for authenticated multi-user deployment.

## The AI coach

AI in GUD CRM is an on-demand opportunity coach, not a generic chat box.

It uses bounded, relevant context from the current record:

- company, sector, fit, and scale;
- linked contacts and decision-maker coverage;
- stage, temperature, priority, owner, and outreach angle;
- the eight most recent activities and eight relevant tasks;
- an approved outreach playbook;
- do-not-contact state, overdue promises, channel repetition, and other warnings.

Every response has a validated structure:

- a relationship summary;
- up to three next actions with reason, timing, and confidence;
- LinkedIn/email/call/letter drafts to adapt;
- sensible, distinctive, and bold creative ideas with cost bands;
- safety and relationship warnings;
- provider/model/prompt provenance and token metadata;
- feedback: Useful, Not useful, or Already tried.

You can copy a draft or turn a suggested action into a real dated task. Nothing is auto-sent, auto-scheduled, or silently executed. CRM text is treated as untrusted reference data, provider output is schema-validated, generation is rate-limited, and the UI labels every result for human review.

### Zero-key local coach

The default provider is deterministic, instant, private to the process, and needs no API key:

```dotenv
AI_ENABLED=true
AI_PROVIDER=local
```

This is ideal for product development, demos, and verifying the complete coaching workflow without API cost.

### OpenAI provider

To get model-generated coaching, use the OpenAI Responses API adapter:

```dotenv
AI_ENABLED=true
AI_PROVIDER=openai
AI_MODEL=gpt-5.6-luna
OPENAI_API_KEY=your-key-here
AI_TIMEOUT_MS=30000
AI_RATE_LIMIT=6
```

Restart the app after changing provider settings. Workspace admins can enable or disable the coach from Settings, where **Configure OpenAI** gives a copy-ready server configuration and a direct route to project API keys. The app intentionally never accepts the live secret in a browser form: keep API keys in `.env.local`, VPS/CapRover secret variables, or a managed secret store—never browser code or Git.

## Ideas, targets and enrichment

The pre-pipeline workspace keeps target finding out of the live opportunity board. A target can be added manually or imported from the tracker, researched in GUD CRM, or handed to Codex/Cowork through a copy-ready brief and versioned JSON pack. Returned JSON is matched by IDs, domain, then normalised name; existing notes, source URLs and contacts are merged rather than replaced. Importing never promotes a target.

The two shapes are separate destinations instead of a dense toggle:

- **Ideas** exists in Service Sales. It asks whether an audience problem or market change is real enough to support an existing or emerging service. Ideas can be edited, researched externally or deleted, and remain separate from named prospects.
- **Targets** exists in both sales models. It asks whether a particular organisation is worth pursuing, records qualification evidence and contact routes, and lets the team shape the provisional opportunity before it reaches the pipeline.
- **Focused Sales** shows Targets only. It does not expose the market-Ideas workflow that a single-product team normally does not need.

The assistant handoff is a compact disclosure rather than a permanent instruction panel. Open it only when you want a guarded research brief, JSON round-trip or browser-capable coworker. If the workspace is connected through MCP, the coworker can submit the same cited findings directly for human review.

Company and opportunity forms also expose **Just talk** in compatible browsers. The browser's speech service produces a transcript, the configured OpenAI provider turns that transcript into a structured draft, populated fields are highlighted for review, and nothing is saved automatically. Opportunity speech always produces a reviewable opportunity title when work is described. Only Opportunity and Organisation are required; websites are optional, and a bare domain is normalised to HTTPS. GUD does not store raw audio, but the browser or operating-system speech provider may process it under its own privacy terms.

Named contact enrichment is deliberately one-at-a-time. **FreeMax** now lives where it is used, at the top of **Targets**. It uses free resources in the order the workspace chooses: Hunter's recurring monthly allowance is the sensible default, while Voila Norbert's one-off starter pool can be first or fallback. An admin can connect, disconnect or reorder either provider there and continue immediately—no restart is required. Stored keys are encrypted using the deployment auth secret, never returned to the browser, and never included in Git.

Environment variables remain a useful deployment-level fallback:

```dotenv
HUNTER_API_KEY=your-hunter-key
VOILA_NORBERT_API_KEY=your-norbert-key
HUNTER_FREE_MONTHLY_LIMIT=50
NORBERT_FREE_LIFETIME_LIMIT=50
```

The action requires a confirmed company website and contact name, refuses do-not-contact records, and records provider provenance in the audit log. It stops after the first successful provider, never verifies again automatically, and stops at GUD CRM's configured free-first safety caps. Failed finds use no finder credit with either provider. The small allowance readout is GUD CRM's tracked usage; the provider dashboard remains authoritative if the same account is used elsewhere or is on a paid plan.

Hunter currently provides 50 free credits each month with API access. Norbert provides the first 50 successful leads free; this is a starter pool, not a monthly refill. Provider terms can change, so the limits are environment-controlled instead of hard-coded into the workflow.

## Connect Codex, ChatGPT or another MCP coworker

On a PostgreSQL deployment, GUD can expose a small remote [Model Context Protocol](https://modelcontextprotocol.io/) endpoint. This lets a user connect their preferred AI workspace once, sign into GUD through OAuth, then ask it to review the pipeline, prepare cited research, add an opportunity, update a next action or log a confirmed activity.

```text
https://crm.example.com/mcp
```

Connect it once:

- **Codex desktop or IDE:** open **Settings → MCP servers → Add server**, choose **Streamable HTTP**, paste the URL, save/restart, then select **Authenticate**.
- **ChatGPT Work:** enable developer mode, create a custom app in **Settings → Apps**, provide the URL, scan the tools, and complete GUD's OAuth screen. Workspace plan and admin controls determine whether write tools are available.
- **Separate GUD instances:** add each hostname as a separate connection. Credentials, grants and data never cross between them.

See the current [Codex MCP connection guide](https://developers.openai.com/codex/mcp/) and [ChatGPT custom MCP app guide](https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt-beta) for the latest client-side menu wording.

Enable it deliberately:

```dotenv
MCP_ENABLED=true
```

The connector uses the same GUD account, organisation and role boundary as the browser application. OAuth 2.1 uses PKCE, short-lived access tokens and refresh tokens; connection grants are stored in the instance's PostgreSQL database and can be revoked. Read-only is the safe default, and GUD activates write tools only after the user explicitly approves read/write access on its connection screen. SQLite and demo workspaces never expose remote MCP access.

The first release keeps the tool surface purposeful:

| Tool | Purpose |
| --- | --- |
| `describe_workspace` | Learn the edition, offers, stages, activity types and guardrails before acting. |
| `list_opportunities` / `get_opportunity` | Review the book of work and one relationship in context. |
| `search_companies` | Avoid creating a duplicate organisation. |
| `submit_research_results` | Merge cited public evidence and contact candidates into Researching for human review. |
| `create_opportunity` / `update_opportunity` | Create or apply a bounded patch; Won/Lost moves require explicit confirmation. |
| `set_next_action` / `log_activity` | Record an owned follow-up or a sales touch the user confirms really happened. |
| `find_work_email` | Use the workspace's configured FreeMax provider order and visible allowances. |

The MCP server does not scrape LinkedIn, store browser cookies, send outreach, delete records or provide raw database access. External pages are untrusted evidence. Research submissions require public HTTP(S) source URLs, writes are schema-bounded, every mutation is organisation-scoped and audit logged, and clients can connect with `gud:read` only or `gud:read gud:write`.

For the two-instance pattern, connect each hostname separately. An HSM-style focused workspace and an agency/service workspace therefore retain separate accounts, grants and databases even when both run the same image.

## Choose the VPS database deliberately

SQLite can comfortably handle the expected data volume on one small VPS. Database size is not the reason PostgreSQL is currently the supported live path. The reason is authentication: GUD's SQLite runtime intentionally acts as one trusted admin session, while PostgreSQL mode activates separate users, passwords, revocable sessions and organisation scoping.

That means **SQLite is suitable now for local/private work, but the current build must not expose SQLite mode directly to the internet**. An internet-facing team deployment should use PostgreSQL until the planned SQLite team-auth mode is implemented and security-tested. See [VPS deployment and database choices](docs/VPS-DEPLOYMENT.md) for the exact boundary and [the CapRover runbook](docs/CAPROVER.md) for deployment.

For the database only:

```powershell
Copy-Item .env.example .env
# Edit .env: set DATA_BACKEND=postgres and replace every example secret.
docker compose up -d db
npm run db:migrate
npm run db:seed
npm run dev
```

For the complete application stack:

```powershell
docker compose up --build
```

The production image automatically applies committed migrations before starting Next.js. For the first empty database, set `GUD_BOOTSTRAP=if-empty` and provide the four explicit `SEED_*` values; after the first successful sign-in, turn bootstrap off and remove the temporary password. Docker Compose and the production environment refuse missing database/auth/public URL secrets, so local defaults cannot silently become live configuration.

### Team access and password recovery

SQLite stays intentionally single-session: it is the fast development workspace, not a fake multi-user security boundary. You can prepare the team roster and roles locally, then PostgreSQL activates separate Better Auth accounts.

In PostgreSQL mode an admin can add a user with a temporary password, edit their name/email/role, reset their password, or deactivate them. Deactivation revokes their sessions. Public sign-up is disabled. Password-reset links appear on the sign-in screen only when a real email sender is configured:

```dotenv
RESEND_API_KEY=re_...
AUTH_FROM_EMAIL=GUD CRM <crm@your-domain.example>
```

Reset tokens are time-limited by Better Auth and a successful reset revokes other sessions. Keep the Resend key in VPS/CapRover secrets, never in browser code.

### Environment reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATA_BACKEND` | inferred | `sqlite`, `demo`, or `postgres`; SQLite is used when no database URL exists. |
| `SQLITE_PATH` | `data/gud-crm.db` | Local database location. |
| `GUD_DEFAULT_MODEL` | `focused` | `focused` or `service`; selects the public fixture in demo mode and seeds the model for a new persistent workspace. Existing workspaces keep their saved model. |
| `GUD_INSTANCE_NAME` | `Local sales workspace` | Private deployment label shown in the navigation. |
| `GUD_VERSION` | `0.1.0` | Release or commit label shown in safe-update readiness. |
| `GUD_BOOTSTRAP` | `off` | Production startup bootstrap: `off` or `if-empty`; use only for a new PostgreSQL database. |
| `LOCAL_TRACKER_PATH` | `data/imports/outreach-tracker.xlsx` | Optional local workbook shown in Settings; keep it outside Git. |
| `DATABASE_URL` | none | PostgreSQL connection string; required with `DATA_BACKEND=postgres`. |
| `BETTER_AUTH_SECRET` | none in PostgreSQL | Required random 32+ character secret for persistent multi-user use. |
| `BETTER_AUTH_URL` | none | Canonical application URL for production authentication. |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Browser-facing application URL. |
| `RESEND_API_KEY` | none | Server-only Resend credential; enables password-reset email with `AUTH_FROM_EMAIL`. |
| `AUTH_FROM_EMAIL` | none | Verified sender used for account recovery. |
| `MCP_ENABLED` | `false` | Enables the authenticated remote `/mcp` connector on a PostgreSQL deployment. |
| `AI_ENABLED` | `true` | Deployment-level AI kill switch. |
| `AI_PROVIDER` | `local` | `local` or `openai`. |
| `AI_MODEL` | `gpt-5.6-luna` | OpenAI model used by the provider adapter. |
| `OPENAI_API_KEY` | none | Server-only API credential for the OpenAI provider. |
| `HUNTER_API_KEY` | none | Optional deployment fallback for Hunter. A workspace admin can override or disconnect it in Settings without a restart. |
| `VOILA_NORBERT_API_KEY` | none | Optional deployment fallback for Voila Norbert. A workspace admin can override or disconnect it in Settings without a restart. |
| `HUNTER_FREE_MONTHLY_LIMIT` | `50` | Local monthly safety cap for successful Hunter finds initiated by GUD CRM. |
| `NORBERT_FREE_LIFETIME_LIMIT` | `50` | Local lifetime safety cap for successful Norbert starter finds initiated by GUD CRM. |
| `COMPANIES_HOUSE_API_KEY` | none | Reserved server-only key for UK company validation. |
| `GOOGLE_MAPS_API_KEY` | none | Reserved server-only key for location checks with quota controls. |
| `AI_TIMEOUT_MS` | `30000` | Provider timeout, 5-120 seconds. |
| `AI_RATE_LIMIT` | `6` | Suggestions per user per 15-minute window. |
| `GUD_BACKUP_WEBHOOK_URL` | none | Private pre-update backup hook; must report success before deployment is requested. |
| `GUD_DEPLOY_WEBHOOK_URL` | none | Private, narrowly scoped release/deployment hook used by an admin after backup succeeds. |

`GET /api/health` reports the active mode and database availability without exposing credentials or the SQLite path.

For a first workspace, daily operating rhythm, backup routine and launch handoff, use [Getting started](docs/GETTING-STARTED.md) and [Operations](docs/OPERATIONS.md). The implemented controls, dependency findings, accepted development-only exception and verification commands are recorded in [Security](docs/SECURITY.md).

## Import an outreach tracker

Source workbooks are intentionally ignored by Git. Preview one first:

```powershell
npm run import:tracker -- "C:\path\to\outreach-tracker.xlsx"
```

The preview checks the 23-column contract and reports row totals, unique companies, contacts, duplicate source rows, invalid rows, and stage mapping. Nothing is written. The same preview is visible in **Settings → Tracker import**; when it is clean, **Import into workspace** performs the write.

For local SQLite, commit after reviewing the preview—no organisation ID or database server is required:

```powershell
npm run import:tracker -- "C:\path\to\tracker.xlsx" --commit
```

For PostgreSQL, select the destination organisation:

```powershell
$env:ORGANISATION_ID="00000000-0000-4000-8000-000000000001"
$env:IMPORT_USER_ID="your-auth-user-id" # optional
npm run import:tracker -- "C:\path\to\tracker.xlsx" --commit
```

Both import paths are checksum-protected and safe to rerun. Companies match by normalised domain first and normalised name second; contacts are deduplicated within their company. Workbook `Paused`, `Watch`, `Closed`, and no-fit research rows map to **Research holding**, never Lost or Nurture. SQLite preserves the research note, source URLs, people-search URL, buyer roles, priority reason, scale, fit, outreach angle, next action and every named contact. PostgreSQL additionally keeps the original row as import metadata and commits transactionally.

When exactly one offer is active, tracker and research imports assign it automatically. With several offers, structured research can supply `offerId` or `offerName`; otherwise the new record stays unassigned in Research and cannot be promoted accidentally. This keeps bulk imports quick without guessing the service being pitched.

## Architecture

```mermaid
flowchart LR
  U["Browser"] --> N["Next.js 16 / React 19"]
  A["Codex / ChatGPT / MCP client"] --> M["OAuth 2.1 + /mcp"]
  M --> N
  N --> S["Validated server actions"]
  M --> T["Bounded MCP tools"]
  T --> R
  S --> R["CRM repository"]
  R --> Q[("SQLite - local")]
  R --> P[("PostgreSQL - VPS")]
  S --> F["FreeMax: Hunter then Norbert"]
  S --> C["Bounded AI context"]
  C --> L["Local coach"]
  C --> O["OpenAI Responses API"]
  O --> V["Structured output validation"]
  L --> V
  X["Local XLSX tracker"] --> I["Preview + validated importer"]
  I --> Q
  I --> P
```

- UI: Next.js App Router, React, TypeScript, dnd-kit, Lucide, responsive custom CSS.
- Local data: SQLite with WAL, automatic bootstrap, audit events, AI feedback, and rate-limit state.
- Production data: PostgreSQL and Drizzle ORM with committed migrations.
- Identity: Better Auth with organisation membership and role fields in PostgreSQL mode.
- Access control: admin/manager/sales-support separation, admin-managed accounts, session revocation on deactivation, optional Resend-backed password recovery, and disabled public sign-up.
- Safety: organisation-scoped writes, audit records, explicit preview/commit boundaries, no automatic outreach.
- AI: provider interface, bounded context assembly, Zod structured outputs, local/OpenAI adapters, timeouts, rate limits, and human feedback.

## Repository map

```text
src/app/                  routes, health endpoint, and server actions
src/components/           interactive CRM workspaces
src/db/schema.ts          PostgreSQL organisation-scoped model
src/lib/ai/               context, schemas, and provider adapters
src/lib/data/             SQLite store and shared read repository
src/lib/import/           XLSX preview and transactional import
src/lib/mcp/              authenticated MCP tools and CRM service boundary
drizzle/                  committed PostgreSQL migrations
scripts/                  seed, import, and local database utilities
business dev/             product plan and non-runtime working material
```

## Development commands

```powershell
npm run dev               # local development server
npm run demo:focused      # fictional single-product demonstration
npm run demo:service      # fictional multi-service demonstration
npm run typecheck         # strict TypeScript check
npm run lint              # ESLint
npm test                  # domain, import, and AI contract tests
npm run security:audit    # advisories plus the documented dev-only exception
npm run privacy:audit     # tracked data files and non-placeholder identities
npm run build             # production build
npm run build:runtime-tools # bundle migration/bootstrap utilities for the standalone image
npm run start             # serve .next/standalone
npm run auth:smoke        # real HTTP auth flow against a running PostgreSQL app
npm run db:generate       # generate a PostgreSQL migration
npm run db:migrate        # apply committed PostgreSQL migrations
npm run db:seed           # seed the PostgreSQL workspace
```

Before opening a pull request, run typecheck, lint, tests, and build. Changes involving personal data, imports, authentication, attachments, or AI should include a brief threat/privacy note.

### Data-safe upgrades

SQLite snapshots are versioned and migrated in place. The Offer upgrade is additive: it creates a default core offer and links every existing opportunity without replaying older roster, stage or example-data migrations. PostgreSQL migration `0002_charming_morlun.sql` creates the relational offer table, seeds one default offer per existing organisation, then links existing opportunities before adding indexes and the foreign key. Back up before deployment as usual; do not reset a real local workspace to pick up a schema change.

## Production checklist

1. For the currently supported internet-facing team deployment, select `DATA_BACKEND=postgres`; use a separately backed-up PostgreSQL database.
2. Store strong auth, database, and provider secrets outside the repository; the app now refuses an insecure PostgreSQL auth configuration.
3. Terminate TLS at Caddy, nginx, or the platform edge and set the canonical HTTPS auth URL.
4. Confirm the image's startup migration succeeds in staging before deploying the same image to production.
5. Back up PostgreSQL and the persistent `/app/uploads` volume daily; encrypt backups, retain multiple restore points, and test restores.
6. Keep trackers, SQLite databases, exports, and uploads outside Git and limited to authorised staff.
7. Review retention, lawful-basis, suppression, access, and deletion obligations before loading real personal data.
8. Run the committed CI checks, including the PostgreSQL sign-in/session/sign-out smoke test and dependency audit.
9. Red-team prompts and review AI outputs before enabling the OpenAI provider for real customer context.

Attachment schema/storage foundations exist, but authenticated upload/download routes are still roadmap work. The coach deliberately remains advisory and on demand.

## Roadmap

- Authenticated attachment delivery with size/type limits and a malware-scanning hook.
- Admin-managed playbook and message templates used directly by the coach.
- Organisation-wide privacy export/delete tooling and fuller suppression audit workflows.
- Stage conversion and time-in-stage reporting from history.
- Broader browser regression coverage beyond the committed PostgreSQL authentication smoke test.
- A reviewed SQLite-to-PostgreSQL promotion/import command before moving either existing private workspace to the VPS.

## Licence

GUD CRM is released under the [MIT Licence](LICENSE). Copyright (c) 2026 paolodit.
