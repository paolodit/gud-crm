# Connect ChatGPT, Codex or another MCP client

GUD can expose a private, authenticated MCP endpoint so an AI workspace can inspect the pipeline and make **bounded CRM updates**. It is a tool layer over GUD's normal business rules, not direct database access.

Remote MCP is available only on an HTTPS PostgreSQL deployment with `MCP_ENABLED=true`. Each GUD instance has its own endpoint:

```text
https://your-gud-domain.example/mcp
```

## The five-minute path

1. On the GUD server, set `MCP_ENABLED=true` and make sure both public URL variables use the same HTTPS origin.
2. Redeploy, sign in to GUD and open **Settings → Connect an AI coworker**.
3. Copy the displayed `/mcp` endpoint.
4. Add it as a remote MCP app/server in your AI client, then complete GUD's sign-in and consent screen.
5. Paste this first prompt:

```text
Review my GUD sales brief. Show the three opportunities that most need
attention, explain why, and wait for me to choose before changing anything.
```

The MCP connection does **not** need an OpenAI API key. It authenticates with the user's GUD login and OAuth consent. `OPENAI_API_KEY` is only for GUD's separate voice-to-fields and AI coach features.

There is no separate MCP package to install: the server ships inside GUD and uses the same database, permissions and audit trail.

## What the connection can do

| Job | Tools |
| --- | --- |
| Understand the workspace | Describe offers, stages, members and activity types |
| Start the day | Get an owner-scoped sales brief with weighted value, stage balance, attention items and upcoming actions |
| Review sales work | List and inspect opportunities; search organisations |
| Review several records efficiently | Read up to ten known opportunities in one `get_opportunities` call |
| Track delivery | List won work with `list_live_projects`; change its milestone, due date, notes or delivery stage with `update_live_project` |
| Capture research | Submit cited account/contact research into the human-review target stage |
| Create and shape work | Create opportunities; update opportunity and organisation details |
| Maintain relationships | Add or update a contact while preserving provenance and do-not-contact metadata |
| Keep momentum | Set a next action, complete a task and log a confirmed activity |
| Tidy safely | Archive or restore an opportunity or organisation without deleting history |
| Enrich deliberately | Find one named contact's work email through configured FreeMax providers |

GUD does not expose arbitrary SQL, generic delete, team administration, pipeline configuration or outreach-sending tools.

### The most useful entry point

`get_sales_brief` is designed for the question people actually begin with: **“Where am I, and what should I do next?”** It defaults to the signed-in user; choose `scope: team` for a whole-pipeline review or pass a current member ID for one owner. It returns:

- active opportunity and pipeline-value totals;
- weighted pipeline value;
- stage-by-stage counts and value;
- overdue, missing-next-action and at-risk records;
- actions due inside a configurable 1–30 day horizon;
- stable opportunity, company, task and stage IDs for the next call.

It is deterministic and read-only. It does not use model credits and cannot alter the CRM.

## Connect ChatGPT

1. In GUD, open **Settings → Connect an AI coworker** and copy the endpoint.
2. In ChatGPT, enable developer mode for your supported Business, Enterprise or Edu workspace.
3. Open **Settings → Apps → Create**, paste the endpoint, choose OAuth and add these **Base scopes**, one per line: `gud:read` and `gud:write`.
4. Click **Create**. ChatGPT discovers the OAuth endpoints and tools as part of creation; some interfaces do not show a separate **Scan Tools** button.
5. Sign in with your normal GUD account, then approve **read & write** on GUD's permission screen.
6. Set GUD's ChatGPT action permissions to **Allow all actions** (or approve individual actions when prompted).
7. Try: `Review my pipeline, show what needs attention, and wait for me to choose a record before changing anything.`

New connections request bounded read-and-write access so ChatGPT can perform the workflows above. A client can still request only `gud:read`. Existing read-only connections never silently gain write access: disconnect them in GUD Settings, reconnect and approve the new permission screen.

After deploying a GUD release that adds or changes tools, refresh/rescan the app's actions in ChatGPT. If the host keeps an older OAuth grant, disconnect and reconnect it.

Workspace availability and approval controls are determined by the ChatGPT plan and workspace administrator.

OpenAI's current setup and availability notes are maintained in [Developer mode and MCP apps in ChatGPT](https://help.openai.com/en/articles/12584461).

## Connect Codex or another MCP client

Create a **Streamable HTTP** MCP server using the same `/mcp` endpoint. Save, authenticate in the browser and approve the GUD permission screen. The exact menu differs by client, but the OAuth flow and scopes are the same.

## Multiple GUD instances and teams

An MCP connection belongs to exactly one GUD origin and its database. Connect every deployment separately; a demo connection cannot see or update production.

| Installation | Example endpoint | Suggested client name |
| --- | --- | --- |
| Main workspace | `https://crm.example.com/mcp` | `GUD — Main` |
| Another business or product | `https://sales.example.net/mcp` | `GUD — Product team` |
| Demo or training | `https://demo.example.com/mcp` | `GUD — Demo` |

All installations run the same repository release. They do **not** need custom source files. Each one needs its own canonical domain, PostgreSQL database, environment variables and users; set `MCP_ENABLED=true` and deploy the current release to each server before connecting it.

For another person on the same GUD installation:

1. give them a normal GUD user account with the appropriate role;
2. give them the instance's `/mcp` URL;
3. have them create or connect the app and sign in with **their own** GUD account;
4. have them approve the requested read/write scope; and
5. enable the app and intended actions for their ChatGPT workspace role where managed-workspace controls apply.

Do not share one person's OAuth grant. GUD resolves every request to the authenticated user and current organisation, and each user can revoke their own connection in Settings. In ChatGPT, app availability, allowed actions and the GUD OAuth identity are separate controls.

When GUD is upgraded, deploy the same tested commit or image to every instance. Users normally only need to refresh the app's actions after tools change. Reconnect only when OAuth scopes or authorization behavior changed, or when the existing grant is stale. Set `GUD_VERSION` to the release or commit label so administrators can confirm the running version in GUD Settings.

## Built-in coworker workflows

Compatible clients can discover three reusable prompts and two resources:

| Item | Use |
| --- | --- |
| Prompt `review_my_sales` | Starts with the sales brief, limits the first view to three attention items and waits before writing |
| Prompt `capture_sales_update` | Turns natural language into a checked activity and next action without guessing missing facts |
| Prompt `research_for_gud` | Finds cited research and returns it for human review |
| Resource `gud://workspace/context` | Current offers, stages, activity types, team and safety guardrails |
| Resource `gud://workspace/workflows` | Recommended read-first sequences for review, updates, research and enrichment |

Tool calls return both human-readable text and machine-readable structured content. Structured responses use stable record IDs; writes also return an explicit saved-record receipt. This makes chained requests reliable without exposing SQL or database credentials.

### Efficient reads and live-project updates

MCP server 0.4.0 adds bounded batch reads and delivery tools. Refresh the tool list after upgrading; these tools use the existing `gud:read` and `gud:write` permissions. OAuth consent is not broadened automatically.

- `describe_workspace` loads configuration without opportunity histories. It includes the delivery stage IDs.
- `list_opportunities` filters in PostgreSQL before loading the matching records. Use `query`, `stageId` / `stageName`, `ownerId`, `offerId` or `needsAttention`. `limit` defaults to 50 (maximum 100); `offset` starts at 0. Increase offset by the previous page size until fewer than `limit` records are returned. Lists and briefs skip activity and AI-history queries.
- `get_opportunity` loads the requested record only. `get_opportunities` accepts `{ "opportunityIds": ["<uuid>", "<uuid>"] }` for up to ten records in one request. Its result contains `records` and `missingIds`, with contacts, open tasks, up to 20 recent activities, delivery details and record links. Unknown IDs do not reveal records from another workspace.
- `list_live_projects` returns `projects`, `total`, `nextOffset` and the workspace’s configured `deliveryStages`. It includes won sales and directly added projects, excludes the delivery archive, and accepts `query`, `ownerId`, `limit` and `offset`. Each project has a `source` (`sales` or `direct`); direct projects are not sales opportunities and are currently edited in the Live projects UI.
- `update_live_project` requires write access and an active won opportunity. It accepts a partial delivery object: omitted fields remain unchanged, `dueDate: null` clears the date, and an empty string clears milestone or notes. It never changes sales status or sends messages.

Example delivery update after reading the record and confirming the user's intent:

```json
{
  "opportunityId": "<uuid from GUD>",
  "delivery": {
    "stage": "client_review",
    "nextMilestone": "Approve the homepage designs",
    "dueDate": "2026-10-16"
  }
}
```

Use the current delivery stage IDs from `describe_workspace`, not a hard-coded list. The default IDs are `kickoff`, `in_progress`, `client_review`, `on_hold`, `complete`; admins can change the stage list in Settings → Live projects. Due dates use `YYYY-MM-DD`. The saved response returns the opportunity ID and complete delivery details; all writes are audited. Setting `archivedAt` to an ISO timestamp archives delivery only; `null` restores it. Confirm archive intent first. The sales opportunity and activity history remain unchanged. There is no response cache that could mix tenants or conceal a recent write. Request latency still depends on hosting, database size and network conditions.

## Useful requests

Start with a read, then name the intended change:

```text
Review my live projects. Show what's waiting for client feedback and the next
milestones. Read the three projects we choose in one batch. Don't change anything yet.
```

```text
For the won project we just reviewed, move delivery to Client review and set
the next milestone to “Approve designs” on 16 October 2026. Keep sales as Won
and show me the saved delivery details.
```

```text
Give me my seven-day sales brief. Separate overdue work from actions due soon,
show weighted pipeline value, and recommend one place to start. Do not edit yet.
```

```text
Show my overdue or missing next actions. For the opportunity I choose,
set a specific next action for next Tuesday at 10:00.
```

```text
Open the Acme opportunity, add Jo Patel as Head of Operations using this
LinkedIn URL, make Jo the primary contact, and show me the saved record.
```

```text
Log the call I just described using GUD's current activity taxonomy, then
add the follow-up we agreed. Do not infer anything I did not say.
```

```text
I spoke to Alex at Acme this morning. They want the outline by Friday and
prefer email. Find the right record, show me the activity and next action you
would save, and wait for my approval.
```

```text
Research Acme for our advisory offer. Cite a public source for every material
claim and submit the result to GUD for review; do not start outreach.
```

For consequential changes, be explicit:

```text
Archive opportunity <ID>. I understand it will leave active views but retain
its contacts, activities, tasks and audit history.
```

## Permission and safety model

- OAuth 2.1 with S256 PKCE authenticates the person; access tokens last one hour and the connection can be revoked from GUD Settings.
- `gud:read` and `gud:write` are separate scopes. Every write checks both the token scope and the stored consent grant.
- Every request resolves the active GUD user and organisation before a tool is constructed. IDs from another workspace are rejected.
- Inputs are bounded and schema-validated. URLs must be complete HTTP(S) URLs.
- All mutations use named service operations and create an audit event attributed to the connected user.
- Tool annotations tell compatible clients which actions read, write, reach an external provider or need consequential-change confirmation.
- Won/Lost moves, archives and removal of do-not-contact protection require explicit confirmation.
- Research stays in human review, and GUD never sends outreach through MCP.

See [Security](SECURITY.md) for the full trust boundary.

## Server setup

Set the normal production authentication variables plus:

```dotenv
DATA_BACKEND=postgres
MCP_ENABLED=true
BETTER_AUTH_URL=https://your-gud-domain.example
NEXT_PUBLIC_APP_URL=https://your-gud-domain.example
```

The two public origins must match exactly and the deployment must be reachable over HTTPS. Do not share database credentials or API keys with the MCP client.

Run the deployment preflight before publishing:

```bash
npm run deploy:check
```

Then confirm that `/api/health` is healthy and that an unauthenticated request to `/mcp` is refused. A `401` from the bare MCP URL is expected; the AI client completes OAuth in the browser.

For deployment details, use [Docker](DOCKER.md), [CapRover](CAPROVER.md) or [VPS deployment](VPS-DEPLOYMENT.md).

## Troubleshooting

**ChatGPT lists GUD tools but reports `Unknown tool` for a `gud.*` name**

Deploy GUD MCP server version 0.3.1 or later, then press **Refresh** on the GUD app in ChatGPT. Current releases accept both GUD's canonical tool names (such as `update_opportunity`) and the namespaced forms some clients send back (such as `gud.update_opportunity`). Older releases could advertise a client-namespaced name that the dispatcher did not recognise.

**GUD returns to the sign-in screen instead of showing consent**

Deploy a release containing the OAuth sign-in continuation fix, then recreate the ChatGPT app. GUD must retain ChatGPT's authorization and PKCE parameters across password sign-in so it can continue to the read/write consent screen.

**The connection can read but cannot update**

The current OAuth grant may predate GUD's explicit-consent enforcement. Deploy the current release, disconnect the app in GUD Settings, reconnect with both Base scopes (`gud:read` and `gud:write`), and approve **read & write** on GUD's permission screen. Settings should then show the connection as **Read & write**.

**ChatGPT cannot see a newly deployed tool**

Refresh or rescan the app's actions. If that does not replace the cached tool list, disconnect and recreate the app connection.

For a published ChatGPT app, action updates are not silently enabled. Refresh the app's actions and review the diff; newly discovered actions may need to be enabled by the workspace administrator.

**The endpoint says MCP is unavailable**

Confirm PostgreSQL mode, `MCP_ENABLED=true`, the canonical HTTPS URLs and `/api/health`, then redeploy.

**A write was refused**

Read the returned record first and use current IDs from GUD. Consequential changes need an explicit confirmation flag, and archived records must be restored before ordinary updates.

**The AI coworker says it needs an OpenAI key**

The MCP connection itself does not. Check that you copied the `/mcp` endpoint from **Connect an AI coworker**, not the separate AI coach setup. An OpenAI API key is only needed for voice-to-fields and model-generated coaching inside GUD.
