# Board refinements: one-off rollout steps

These are explicit, database-specific maintenance operations, not automatic app
migrations. Deploy checklist support before converting any notes, and take a
fresh backup of each database being changed. Leave other instances untouched.

- `refresh-delivery-tasks.sql`: **gud_refresh only**. Converts each non-empty
  hyphen-prefixed line in active Live project delivery notes into an unchecked
  task. Keeps existing tasks and all non-bullet notes, project values, ownership,
  milestones and ordering. Covers standalone projects and won sales projects.
  Archived projects are left unchanged. Records before/after audit entries and
  a workspace marker so it cannot convert twice.
- `demo-gone-cold.sql`: **gud_demo only**. Adds the default Gone Cold stage before
  Won/Lost without reseeding or changing any opportunities. Skips pipelines
  where an active Gone Cold stage already exists. New installations receive
  this stage from the normal edition defaults.

These SQL scripts end in `ROLLBACK`, so their first execution is a preview. Review
the result and any errors before changing only the final `ROLLBACK` to `COMMIT`
and rerunning. A wrong database, overlong task or oversized checklist aborts the
conversion; no truncation or partial conversion is allowed. These scripts have
not been executed against production as part of the source-code change.

After committing, inspect several converted projects, save and reopen a task,
and check all three instance health endpoints. Keep the fresh backup and the
previous application release available for recovery; do not roll back to an
older app that can discard checklist fields while saving delivery details.

## Expand the interactive Demo (September 2026)

`demo-expand-workspace.sql` is restricted to **gud_demo** and the existing
**GUD CRM Demo** workspace. It adds 13 fictional opportunities (including three
won projects), contacts, explanatory fictional activities, ten follow-ups and
five standalone projects with checklists. It preserves existing records and
settings, uses reserved `.example` email addresses, and aborts if required offers
or stages are missing. It never resets or reseeds the database.

Take and verify a fresh backup, run the file as a rollback preview, and review
its counts. Only then change the final `ROLLBACK` to `COMMIT` in the execution
copy and rerun. A workspace marker makes subsequent runs no-ops. This is a
separate, explicit data-maintenance action, not part of application startup or
normal deployment. Never run it on Refresh or HSM. The disposable PostgreSQL
test verifies guard rejection, rollback, retention, delivery schema validity and
idempotency. Hosted Demo Thoughts use ordinary account ownership; the public-demo
flag enables a shared-login warning, not a feature restriction.
