# Operating GUD CRM

## Daily rhythm

1. Open **Pipeline** and scan where the whole book of work stands.
2. Spread a crowded stage into two lanes or use Compact view when density is hiding the picture.
3. Open **Today** when you want the five ranked next moves. They are ranked, not automated; judgement still wins.
4. Log every meaningful attempt and outcome from the opportunity workspace.
5. Create the next owned, dated action while logging the touch.
6. Use **Needs a decision** to fix records that are overdue, at risk, unresponsive or missing a next step.

## Pipeline discipline

- **Outreach active** means at least one real touch is underway; no response is required yet.
- **Conversation active** begins only when a person responds or opens a useful conversation.
- **Proposal / decision** means a defined commercial next step is with the buyer or awaiting a decision.
- **Lost** requires a genuine post-contact commercial loss. Desk research and no-fit targets belong in Research holding.

Admins can rename or add visible sales stages in Settings. Removing a stage is an archive operation: GUD requires a destination and moves every opportunity before hiding the old bucket. The two Targets stages remain protected.

The board describes outcomes. Calls, emails, LinkedIn attempts, letters, demos and useful diagnostics belong in the activity timeline.

## Weekly review

- Clear overdue actions or consciously reschedule them.
- Review opportunities with no next action.
- Check Outreach active records for repeated use of one channel without new value.
- Review quiet conversations and either create a credible next action, return them to Targets or close them.
- Check the Sales guide asset kit for missing or stalled material.
- Review Reports by owner and, when relevant, by offer.
- Download a fresh SQLite backup during development or confirm the latest PostgreSQL backup and restore-test status in production.

## Backups

### SQLite

Use **Settings → Download SQLite backup** after meaningful sessions. Store the file away from the development machine. It contains contact details and activity history, so do not email it or place it in Git.

### PostgreSQL

Take encrypted daily database or volume snapshots, retain multiple restore points and perform a documented restore test. Back up the uploads volume separately when authenticated attachments are introduced.

On CapRover, platform configuration backups do not contain PostgreSQL volume data. Back up each database separately and follow the launch/restore procedure in `docs/CAPROVER.md`.

## Imports

Preview first. Resolve every invalid row. Commit only after the counts and stage mapping make sense. Exact workbook imports are checksum-protected, but a changed file is a new import and deserves a fresh review.

## When something looks wrong

- Use `/api/health` to check runtime and database availability without exposing customer counts.
- Run `npm run db:local:status` for the local store.
- Run the standard typecheck, lint, test, security audit and build commands.
- For live login, run `npm run auth:smoke` against the deployed PostgreSQL instance using a dedicated test account.
- Preserve logs and audit history before changing data. Restore into an isolated database before replacing a live system.
