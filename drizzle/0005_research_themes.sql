CREATE TABLE "research_themes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"offer_id" uuid,
	"owner_id" text,
	"title" varchar(220) NOT NULL,
	"audience" text,
	"problem" text,
	"signal" text,
	"angle" text,
	"status" varchar(24) DEFAULT 'idea' NOT NULL,
	"source_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "research_themes" ADD CONSTRAINT "research_themes_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "research_themes" ADD CONSTRAINT "research_themes_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "research_themes" ADD CONSTRAINT "research_themes_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "research_themes_org_status_idx" ON "research_themes" USING btree ("organisation_id","status","updated_at");
