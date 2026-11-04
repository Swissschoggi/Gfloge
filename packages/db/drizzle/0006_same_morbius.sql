DO $$ BEGIN CREATE TYPE "public"."share_resource_type" AS ENUM('flight', 'trip'); EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"resource_type" "share_resource_type" NOT NULL,
	"resource_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "airports" ALTER COLUMN "tz" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "manual_flights" ADD COLUMN IF NOT EXISTS "field_sources" jsonb;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "share_links" ADD CONSTRAINT "share_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "share_links_token_key" ON "share_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "share_links_user_idx" ON "share_links" USING btree ("user_id","resource_type");