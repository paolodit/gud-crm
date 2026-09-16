# Thoughts — personal thinking space

Thoughts is separate from the shared Marketing Ideas/research workflow, Pipeline and Live projects. The `/thoughts` board supports free-position notes, unnamed lane guides, comfortable/compact views, optional titles/categories, six colours, text/bullets, and draggable lists. View preferences contain no note content. New notes seek free space; dragging saves their coordinates. Archives are reversible, including from the exploration panel, and retain exploration history.

The simpler editor has bold, italic and link toolbar buttons with a formatted preview. Formatting is stored as a small Markdown subset in the existing text field; React escapes raw HTML and links permit only HTTP(S). Existing plain-text notes remain compatible. Uncategorized notes have no generic category label.

## Privacy boundary

- PostgreSQL rows are owned by both the authenticated user and organisation. Every read/write uses both predicates; administrators have no personal-data override. Server actions derive identity from the session, never from client input. Versions prevent stale tabs overwriting newer edits.
- Thoughts and their exploration documents never enter `BoardSnapshot`, shared search, reports, CRM exports or shared audit events. AI rate limits have a separate content-free table.
- Impersonated sessions cannot open Thoughts or authorise external assistants. Shared demos are blocked. Set `GUD_PUBLIC_DEMO=true` for any deployment using public/shared accounts; the existing `guddemo.refreshcreative.com` host is also blocked defensively.
- SQLite is local single-user mode, not a multi-user security boundary: anyone who can use that installation uses the same account. Private data has separate SQLite tables, outside the shared snapshot.
- This is application-level privacy, **not end-to-end encryption**. Infrastructure operators, physical database access and full database backups remain trusted. Full backups contain Thoughts and must be protected accordingly. Never use a shared login to store personal information.
- Development server-function argument logging is disabled so private content is not echoed to the development terminal. The application does not log provider error payloads or private content.

## Exploration

Each click creates a separate document linked to the thought/version actually explored. The docked panel can be resized with its divider or keyboard arrows, pulled out to full width, and switched to the complete personal exploration library. Nothing is appended to the original note. Templates are explicitly labelled as templates, not AI research.

With the existing workspace OpenAI configuration enabled, the user can explicitly send one selected thought (title/text/checklist plus optional exploration direction) for deeper exploration. Direction is validated to 4,000 characters, stays scoped to that note and also appears in offline outlines. Web research is a separate opt-in; it may disclose search queries to search providers. Returned citations are displayed as safe clickable links. No other thoughts, shared CRM records, owners or category names are sent. Failed or incomplete generations do not save partial documents.

Requests use `store:false`, foreground execution, bounded output, a timeout and per-user rate limiting. This does not promise zero provider retention: the provider/account's data controls still apply. See [OpenAI web-search documentation](https://developers.openai.com/api/docs/guides/tools-web-search) and [data controls](https://developers.openai.com/api/docs/guides/your-data).

Voice uses the existing browser speech service after pressing Record. It is not an always-listening wake word. “Gud, new thought”, “bullet”, “to-do” and “explore that” are parsed locally into a reviewable draft. Audio is not saved by GUD, but the browser speech provider may process audio externally. Saving an “explore that” draft opens the panel; AI generation still requires an explicit click.

## MCP

Note and editor microphone buttons open a reviewable voice draft. Apply appends to the existing text, or replaces it when explicitly selected; the original note is saved only with Save thought. The exploration microphone similarly edits the optional direction, not the original note. Recording never starts merely by opening an editor.

Default sales scopes stay unchanged. Personal access requires explicitly requested and consented `gud:thoughts:read`; mutations additionally require `gud:thoughts:write`. For example, a client may request `openid profile email offline_access gud:read gud:thoughts:read gud:thoughts:write`. Existing sales connections cannot silently acquire personal access. Reconnect with the extra scopes and review the consent notice. Both token scopes and recorded consent are checked on every request.

Personal tools: `list_thoughts`, `get_thought`, `save_thought`, `list_thought_explorations`, `save_thought_exploration`. They always operate as the signed-in account; no tool accepts an owner override. External exploration documents are marked `mcp`, not presented as verified GUD research. No private-to-shared conversion or outreach tool is introduced. Disconnect through the existing Settings connection controls.

## Deployment and verification

Apply migration `0011_famous_winter_soldier.sql` through the normal production migration runner before serving the new build. It only adds the personal note, exploration and private rate-limit tables plus foreign keys/indexes. It does not migrate existing CRM content. SQLite creates its separate tables lazily.

Tests cover two-user and cross-organisation isolation, admin non-access, version conflicts, separate exploration history, shared-demo and impersonation rejection, independent MCP grants, provider payload minimisation, failure handling, and the local browser capture/drag/checklist/colour/history/voice flow. Live provider research and multi-user PostgreSQL deployment require staging verification before production rollout.

Related-thought suggestions and conversion into leads/projects remain future work by design.
