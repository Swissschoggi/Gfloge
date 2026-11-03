CREATE TABLE "ref_aircraft_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"icao_type" text NOT NULL,
	"iata_type" text,
	"manufacturer" text,
	"name" text NOT NULL,
	"category" text,
	"wake" text,
	"source" text DEFAULT 'reference' NOT NULL,
	CONSTRAINT "ref_aircraft_types_icao_type_unique" UNIQUE("icao_type")
);
--> statement-breakpoint
CREATE TABLE "ref_airlines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"iata" text,
	"icao" text,
	"name" text NOT NULL,
	"callsign" text,
	"country" text,
	"active" boolean DEFAULT true NOT NULL,
	"source" text DEFAULT 'reference' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ref_airports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"icao" text NOT NULL,
	"iata" text,
	"name" text NOT NULL,
	"city" text,
	"country" text,
	"country_code" text,
	"lat" double precision,
	"lon" double precision,
	"tz" text,
	"active" boolean DEFAULT true NOT NULL,
	"source" text DEFAULT 'reference' NOT NULL,
	CONSTRAINT "ref_airports_icao_unique" UNIQUE("icao")
);
--> statement-breakpoint
CREATE TABLE "ref_countries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alpha2" text NOT NULL,
	"alpha3" text,
	"name" text NOT NULL,
	CONSTRAINT "ref_countries_alpha2_unique" UNIQUE("alpha2")
);
--> statement-breakpoint
CREATE TABLE "reference_datasets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"source" text NOT NULL,
	"source_url" text NOT NULL,
	"license" text NOT NULL,
	"attribution" text NOT NULL,
	"version" text,
	"checksum" text,
	"size_bytes" integer,
	"record_count" integer,
	"status" text DEFAULT 'not_installed' NOT NULL,
	"progress_bytes" integer DEFAULT 0 NOT NULL,
	"error" text,
	"local_path" text,
	"installed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reference_datasets_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE INDEX "ref_airlines_iata" ON "ref_airlines" USING btree ("iata");--> statement-breakpoint
CREATE INDEX "ref_airlines_icao" ON "ref_airlines" USING btree ("icao");--> statement-breakpoint
CREATE INDEX "ref_airports_iata" ON "ref_airports" USING btree ("iata");