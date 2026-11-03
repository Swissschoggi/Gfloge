CREATE TABLE "historical_datasets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"dataset_key" text NOT NULL,
	"title" text NOT NULL,
	"release_tag" text NOT NULL,
	"asset_name" text NOT NULL,
	"download_url" text NOT NULL,
	"size_bytes" integer,
	"sha256" text,
	"date_start" text NOT NULL,
	"date_end" text NOT NULL,
	"license" text NOT NULL,
	"attribution" text NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"progress_bytes" integer DEFAULT 0 NOT NULL,
	"error" text,
	"local_path" text,
	"installed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "historical_datasets_key" ON "historical_datasets" USING btree ("source","dataset_key");