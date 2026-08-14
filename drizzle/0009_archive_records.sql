ALTER TABLE "companies" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "opportunities_archive_idx" ON "opportunities" USING btree ("organisation_id","archived_at");
