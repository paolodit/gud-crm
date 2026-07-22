ALTER TABLE "opportunities" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY stage_id ORDER BY updated_at DESC, id) * 1000 AS next_position
  FROM opportunities
)
UPDATE opportunities
SET position = ranked.next_position
FROM ranked
WHERE opportunities.id = ranked.id;
--> statement-breakpoint
DROP INDEX IF EXISTS "opportunities_board_idx";
--> statement-breakpoint
CREATE INDEX "opportunities_board_idx" ON "opportunities" USING btree ("organisation_id","pipeline_id","stage_id","position");
