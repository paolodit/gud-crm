# GUD Actions + Conversation preview

The global **Talk to GUD** button opens a compact panel that persists between CRM pages. Opt in to sending the conversation and relevant record details to OpenAI, then type or start voice. The older single-record voice review remains available.

## First workflows

- Create/update a sales lead with company/contact details, owner, offer, value, priority, temperature, probability, expected close, outreach angle, company fit/qualification, a typed/outcome-dated touchpoint and scheduled follow-up.
- Find/open an existing lead or project, prepare updates, and switch clients without discarding earlier drafts.
- Add/complete sales follow-ups and project checklist items. Project checklist items do not have independent due dates.
- Create/update live projects with value, owner, offer, stage, milestone/date, appended notes and multiple separate checklist items.
- Create, search, read and update your own private Thoughts with title/body, colour, existing/new category and real checklist items. Shared `all` search excludes Thoughts; personal Thoughts remain disabled on the shared public Demo.
- Close a clean record/editor pop-up by asking GUD. Unsaved manual edits are protected.

Try: “Sarah at Acme wants a £5,000 website before Christmas. Follow up next Thursday at ten.” GUD should look for an existing match, prepare the lead and ask for any genuinely missing offer/identity details. Review the visible fields, then say/type **“Save changes”** or click the button. A successful save receives **“Saved. All Gud.”** Unsaved or failed work gets an explicit draft/error message instead.

## Safety contract

`src/lib/gud-actions/contract.ts` defines allowlisted navigation, scoped search/read, staging, revision, guarded saving, close-record and finishing tools. `save_changes` cannot authorize itself: it requires an independent, explicit user Save command bound to the visible draft IDs/versions. Realtime transcription is correlated with the speech-start item and may arrive after a tool call; GUD waits briefly for it. Old, negated, conditional or vague requests never count. A clear typed Save goes directly through the same guarded transaction without another model request. Both transports require the signed-in member and matching Origin; actor/organisation IDs are never taken from model arguments. Impersonation and non-PostgreSQL workspaces are excluded.

The private `gud_action_drafts` table scopes every read/write by organisation and owner. Drafts expire after 24 hours and survive navigation/reconnection. Manual changes use draft versions. Existing-record fingerprints reject a stale save. The final button commits the reviewed draft versions and their receipts in one PostgreSQL transaction; retrying a saved draft returns its receipt rather than creating another record. Existing service transactions join the outer transaction using request-local AsyncLocalStorage. Failure in a later draft rolls the bundle back.

Tool fields are partial patches: unused fields can be omitted or null (both mean unchanged). Every supplied value remains validated and unknown keys are rejected. Invalid-call feedback names only safe contract fields so GUD can correct its arguments without exposing record values. Project progress updates use the opened project's tasks and milestone; moving to a matching task does not implicitly complete earlier tasks.

No deleting, archiving, terminal won/lost sales moves, outbound messages, arbitrary database actions, invoice operations, whole-database provider upload, or autonomous background work. Private Thought text is not copied into shared audit events.

## Operations and limits

- `GUD_CONVERSATION_ENABLED=false` disables the preview without removing classic voice.
- Uses existing AI connection/key and organisation AI-enabled setting. Keys stay server-side.
- `GUD_REALTIME_MODEL` defaults to `gpt-realtime-2.1`; typed conversation uses `AI_MODEL`.
- Voice uses WebRTC through the server-proxied unified `/v1/realtime/calls` handshake. The browser handles audio/events; every CRM tool call returns to the authenticated server.
- One voice connection per session; ten-minute session limit, two-minute client idle timeout, explicit mic pause/end, and best-effort server provider hangup timer. A server restart loses the in-memory hangup timer, so this is not a guaranteed monetary cap.
- Existing `AI_RATE_LIMIT` applies to conversation starts per member per 15 minutes. Sessions allow at most 120 server actions; model responses are output-bounded. Client-reported realtime token usage is accumulated and labelled as unverified—not a billing ledger. Typed usage is not yet reported in the UI.
- Closing the panel ends voice and keeps unfinished drafts; cancelling clears the draft fields. Expired drafts are unavailable but retained in the private table pending a retention/cleanup policy. Transcripts are kept in the browser component, not a new transcript database.
- A fresh voice connection restores drafts and page context, not a transcript of previous voice sessions. Finish/close never implies permission to save.
- End stops microphone tracks immediately, even while a response is pending. Late responses cannot navigate or speak; any draft already staged is reloaded for review. Lost voice connections close the provider session before reconnecting. A spoken sign-off waits for its own audio to drain, not the preceding response; speaking again interrupts the sign-off.
- The Talk to GUD launcher glows while the microphone is live and pulses when speech is detected, including with the panel minimised. Muting or disconnecting removes the glow. Reduced-motion preferences retain a steady glow without animation. This uses existing voice events, not another audio stream or provider request.
- Manual draft edits are acknowledged independently, so an interrupted second edit can retry without invalidating a successful first edit. An empty amount is never silently converted to £0. The Save button pauses microphone input and rejects late voice actions until Resume mic; an explicit voice save can continue the conversation. Identical adjacent confirmation messages are deduplicated.
- Thought date sorting is a newest-first column display only: Free sort restores the saved manual positions. Categories are saved on private notes, not a shared taxonomy. The category picker explicitly offers existing categories and creation; quick colour controls and swatches are square.

Roll out using `npm run release:all -- --ref <full-sha> --targets demo,refresh`. The target selector allows only canary-order prefixes; omitting it retains the existing all-three rollout. The same guarded image, backups, health checks and record-retention checks apply. HSM is excluded from this preview rollout.

## Verification

Contract tests check the tool boundary, field scopes and honest sign-offs. HTTP tests cover Origin, authentication, actor spoofing, streamed byte limits and exception privacy. The dedicated disposable-PostgreSQL suite covers draft ownership, create-lead contents, idempotent saves, stale edits, concurrent transaction isolation, full rollback, project tasks, Thought privacy and cancellation during provider/voice connection requests. CI additionally exercises the panel against isolated text and WebRTC transport fixtures, including failed-save/retry, partial manual edits, navigation persistence, mobile bounds, delayed tool responses, audio sign-off, immediate mic stop and reconnecting. Fixtures use no physical microphone or live OpenAI calls. A real microphone conversation still needs an interactive browser test with microphone permission and a model-enabled OpenAI project.
