# Operating GUD CRM

## Daily rhythm

1. Open **Today**.
2. Work the five suggested next moves. They are ranked, not automated; judgement still wins.
3. Log every meaningful attempt and outcome from the opportunity workspace.
4. Create the next owned, dated action while logging the touch.
5. Use **Needs a decision** to fix records that are overdue, at risk, unresponsive or missing a next step.
6. Open the full queue only when planning the rest of the week.

## Pipeline discipline

- **Ready to contact** means a credible person and route are identified.
- **Outreach active** means at least one real touch is underway; no response is required yet.
- **Engaged** begins only when a person responds or opens a conversation.
- **Nurture** requires a real relationship signal plus an explicit re-entry trigger.
- **Lost** requires a genuine post-contact commercial loss. Desk research and no-fit targets belong in Research holding.

The board describes outcomes. Calls, emails, LinkedIn attempts, letters, demos and useful diagnostics belong in the activity timeline.

## Weekly review

- Clear overdue actions or consciously reschedule them.
- Review opportunities with no next action.
- Check Outreach active records for repeated use of one channel without new value.
- Review Nurture triggers and dates.
- Check the Playbook asset kit for missing or stalled material.
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
