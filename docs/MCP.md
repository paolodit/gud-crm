# Connect ChatGPT, Codex or another MCP client

GUD can expose a private, authenticated MCP endpoint so an AI workspace can inspect the pipeline and make **bounded CRM updates**. It is a tool layer over GUD's normal business rules, not direct database access.

Remote MCP is available only on an HTTPS PostgreSQL deployment with `MCP_ENABLED=true`. Each GUD instance has its own endpoint:

```text
https://your-gud-domain.example/mcp
```

## What the connection can do

| Job | Tools |
| --- | --- |
| Understand the workspace | Describe offers, stages, members and activity types |
| Review sales work | List and inspect opportunities; search organisations |
| Capture research | Submit cited account/contact research into the human-review target stage |
| Create and shape work | Create opportunities; update opportunity and organisation details |
| Maintain relationships | Add or update a contact while preserving provenance and do-not-contact metadata |
| Keep momentum | Set a next action, complete a task and log a confirmed activity |
| Tidy safely | Archive or restore an opportunity or organisation without deleting history |
| Enrich deliberately | Find one named contact's work email through configured FreeMax providers |

GUD does not expose arbitrary SQL, generic delete, team administration, pipeline configuration or outreach-sending tools.

## Connect ChatGPT

1. In GUD, open **Settings → AI coworker connection** and copy the endpoint.
2. In ChatGPT, enable developer mode if your plan/workspace requires it.
3. Open **Settings → Apps → Create**, paste the endpoint and scan the tools.
4. Sign in with your normal GUD account.
5. Review GUD's permission screen and approve the connection.
6. Try: `Review my pipeline, show what needs attention, and wait for me to choose a record before changing anything.`

New connections request bounded read-and-write access so ChatGPT can perform the workflows above. A client can still request only `gud:read`. Existing read-only connections never silently gain write access: disconnect them in GUD Settings, reconnect and approve the new permission screen.

After deploying a GUD release that adds or changes tools, refresh/rescan the app's actions in ChatGPT. If the host keeps an older OAuth grant, disconnect and reconnect it.

Workspace availability and approval controls are determined by the ChatGPT plan and workspace administrator.

## Connect Codex or another MCP client

Create a **Streamable HTTP** MCP server using the same `/mcp` endpoint. Save, authenticate in the browser and approve the GUD permission screen. The exact menu differs by client, but the OAuth flow and scopes are the same.

Connect every GUD deployment separately. A connection to a demo instance cannot see or update a private production instance.

## Useful requests

Start with a read, then name the intended change:

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

For deployment details, use [Docker](DOCKER.md), [CapRover](CAPROVER.md) or [VPS deployment](VPS-DEPLOYMENT.md).

## Troubleshooting

**The connection can read but cannot update**

The current OAuth grant is read-only. Disconnect it in GUD Settings, reconnect, and approve read & write access.

**ChatGPT cannot see a newly deployed tool**

Refresh or rescan the app's actions. If that does not replace the cached tool list, disconnect and recreate the app connection.

**The endpoint says MCP is unavailable**

Confirm PostgreSQL mode, `MCP_ENABLED=true`, the canonical HTTPS URLs and `/api/health`, then redeploy.

**A write was refused**

Read the returned record first and use current IDs from GUD. Consequential changes need an explicit confirmation flag, and archived records must be restored before ordinary updates.
