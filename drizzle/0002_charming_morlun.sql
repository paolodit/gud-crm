CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"normalised_name" varchar(160) NOT NULL,
	"colour" varchar(16) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"ideal_customer" text DEFAULT '' NOT NULL,
	"positioning" text DEFAULT '' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "offer_id" uuid;--> statement-breakpoint
INSERT INTO "offers" ("organisation_id", "name", "normalised_name", "colour", "description", "ideal_customer", "positioning", "is_default", "active", "position")
SELECT
	"id",
	'Core product',
	'core product',
	'#6554C0',
	'The workspace''s original product or service.',
	'',
	'',
	true,
	true,
	0
FROM "organisations";--> statement-breakpoint
UPDATE "opportunities"
SET "offer_id" = "offers"."id"
FROM "offers"
WHERE "offers"."organisation_id" = "opportunities"."organisation_id"
	AND "offers"."is_default" = true;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "offers_org_name_unique" ON "offers" USING btree ("organisation_id","normalised_name");--> statement-breakpoint
CREATE INDEX "offers_org_active_position_idx" ON "offers" USING btree ("organisation_id","active","position");--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opportunities_offer_stage_idx" ON "opportunities" USING btree ("organisation_id","offer_id","stage_id");
