ALTER TABLE "research_themes" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY organisation_id ORDER BY updated_at DESC, id) * 1000 AS next_position
  FROM research_themes
)
UPDATE research_themes
SET position = ranked.next_position
FROM ranked
WHERE research_themes.id = ranked.id;--> statement-breakpoint
CREATE INDEX "research_themes_org_position_idx" ON "research_themes" USING btree ("organisation_id","position");
