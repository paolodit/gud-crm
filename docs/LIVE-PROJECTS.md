# Keep the work moving after a win

Open **Live projects** in the navigation. Every unarchived opportunity in a sales stage marked **Won** appears automatically. Older wins start in **Kickoff**; no migration moves their sales stages or copies their records.

## Five simple delivery buckets

| Stage | What belongs here |
| --- | --- |
| Kickoff | Agree the brief, people and first milestone |
| In progress | The team is actively delivering |
| Client review | Waiting for feedback or approval |
| On hold | Paused with a reason and next move |
| Complete | Delivered and handed over |

Drag by the card's handle, or click the card and choose its delivery stage. In the same editor, add a next milestone, its due date and delivery notes. Search by company, project or milestone, and filter by owner.

**Sales and delivery are separate.** A project can be In progress while its opportunity remains Won. The owner, contacts and activity stay on the same record. Open **Full record** to see them. Reopening a sale removes it from Live projects; winning it again retains its delivery details. Archiving the opportunity or its company hides it from both active boards without deleting history.

Delivery stages are currently a fixed, shared set. Sales stages remain configurable in Settings. Live projects does not add budgets, dependencies, invoicing or automatic client communications.

## Faster sales-board updates

Each sales card has **Edit**, **Update** and a stage selector. Edit changes the opportunity's fields; Update opens the voice desk. You can also open the full record and use its labelled Edit action. Won/Lost moves ask for confirmation. Drag handles remain available, with the floating card above the board.

## Talk through real work

1. Choose **Talk it through** when creating a record, or **Update / Talk through an update** on an existing opportunity.
2. Choose **Start recording**, or type into the transcript. You can stop, correct the words, or add more by voice.
3. Choose **Prepare for review**. GUD uses the current record, contacts, activity types and your browser's timezone to prepare fields.
4. Check the activity, person, date, notes and next action. Supply any missing date. A request that only schedules future work can use **Create a task only** without claiming a touchpoint happened.
5. Save the reviewed update. This records CRM work; it never emails or calls a contact.

Closing the voice desk cancels recording. The transcript is kept in memory only while the dialog is open. Recognition support and microphone permission depend on the browser. If recording is unavailable, typing still works. Your browser handles speech recognition; only text you choose to prepare is sent to the workspace's configured AI service.

An administrator must configure OpenAI for voice-to-fields or text-to-fields: `AI_ENABLED=true`, `AI_PROVIDER=openai`, a supported `AI_MODEL` and a server-side `OPENAI_API_KEY`. The dialog links to Settings if the connection is missing. Ordinary manual forms do not need an API key. MCP connections use separate OAuth access and do not need this key.

## Upgrade and data safety

PostgreSQL migration `0010_live_delivery.sql` adds one nullable JSONB column. Existing data, contacts, tasks, activity, audit history and sales stages are unchanged. SQLite persists delivery alongside each opportunity in the existing snapshot. SQLite-to-PostgreSQL promotion also carries delivery details.

Back up before deploying. The production container runs committed migrations before startup. The same application image supports every instance; no custom files or shared credentials are needed. See [Operations](OPERATIONS.md) and [MCP](MCP.md) for hosting and assistant access.
