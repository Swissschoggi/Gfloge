CREATE TYPE "public"."alert_type" AS ENUM('time_shift', 'gate_change', 'cancel', 'divert', 'status_change');--> statement-breakpoint
CREATE TYPE "public"."cabin_class" AS ENUM('none', 'eco', 'premium', 'business', 'first');--> statement-breakpoint
CREATE TYPE "public"."display_units" AS ENUM('km', 'mi');--> statement-breakpoint
CREATE TYPE "public"."flight_status" AS ENUM('scheduled', 'boarding', 'enroute', 'arrived', 'cancelled', 'diverted', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."logged_state" AS ENUM('flown', 'planned');--> statement-breakpoint
CREATE TYPE "public"."provider_source" AS ENUM('instance', 'env');--> statement-breakpoint
CREATE TYPE "public"."theme_pref" AS ENUM('system', 'day', 'night');--> statement-breakpoint
CREATE TYPE "public"."tz_display" AS ENUM('airport', 'local', 'utc');--> statement-breakpoint
CREATE TYPE "public"."user_flight_role" AS ENUM('tracked', 'logged');--> statement-breakpoint
CREATE TYPE "public"."user_flight_source" AS ENUM('manual', 'tracked-auto', 'import');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'user');--> statement-breakpoint
CREATE TABLE "aircraft" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration" text NOT NULL,
	"hex_icao" text,
	"aircraft_type_id" uuid,
	"source" text DEFAULT 'seed' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aircraft_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"iata_type" text,
	"icao_type" text,
	"manufacturer" text NOT NULL,
	"name" text NOT NULL,
	"family" text,
	"source" text DEFAULT 'seed' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "airlines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"iata" text,
	"icao" text,
	"name" text NOT NULL,
	"common_name" text,
	"callsign" text,
	"country" text,
	"active" boolean DEFAULT true NOT NULL,
	"source" text DEFAULT 'seed' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "airports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"iata" text,
	"icao" text,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"country" text NOT NULL,
	"region" text,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"elevation_ft" integer,
	"tz" text NOT NULL,
	"source" text DEFAULT 'seed' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flight_id" uuid NOT NULL,
	"user_id" uuid,
	"type" "alert_type" NOT NULL,
	"old" jsonb,
	"new" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"subject" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"airline_id" uuid,
	"flight_code" text NOT NULL,
	"departure_airport_id" uuid NOT NULL,
	"arrival_airport_id" uuid NOT NULL,
	"dep_date_key" text NOT NULL,
	"scheduled_departure" timestamp with time zone NOT NULL,
	"scheduled_arrival" timestamp with time zone NOT NULL,
	"status" "flight_status" DEFAULT 'scheduled' NOT NULL,
	"actual_departure" timestamp with time zone,
	"actual_arrival" timestamp with time zone,
	"dep_terminal" text,
	"dep_gate" text,
	"arr_terminal" text,
	"arr_gate" text,
	"arr_baggage" text,
	"aircraft_registration" text,
	"aircraft_type_id" uuid,
	"distance_km" integer,
	"provider_refs" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"summary" text,
	"imported_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manual_flights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"airline_id" uuid,
	"flight_number" text,
	"departure_airport_id" uuid NOT NULL,
	"arrival_airport_id" uuid NOT NULL,
	"scheduled_departure" timestamp with time zone NOT NULL,
	"scheduled_arrival" timestamp with time zone,
	"dep_date_key" text NOT NULL,
	"aircraft_type_id" uuid,
	"distance_km" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flight_id" uuid NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"lat" double precision,
	"lon" double precision,
	"alt_ft" integer,
	"ground_speed_kt" integer,
	"heading_deg" double precision,
	"vertical_rate" double precision,
	"on_ground" boolean,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ttl_seconds" integer NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" text NOT NULL,
	"config_encrypted" text NOT NULL,
	"masked_hint" text NOT NULL,
	"source" "provider_source" DEFAULT 'instance' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_state" (
	"provider_id" text PRIMARY KEY NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"quota_used" integer,
	"quota_resets_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" text,
	"ip_hash" text
);
--> statement-breakpoint
CREATE TABLE "user_flights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"flight_id" uuid,
	"manual_flight_id" uuid,
	"role" "user_flight_role" NOT NULL,
	"logged_state" "logged_state",
	"tracked_from" timestamp with time zone,
	"tracked_until" timestamp with time zone,
	"seat" text,
	"cabin" "cabin_class" DEFAULT 'none' NOT NULL,
	"note" text,
	"rating" smallint,
	"source" "user_flight_source" DEFAULT 'manual' NOT NULL,
	"import_batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"units" "display_units" DEFAULT 'km' NOT NULL,
	"timezone_display" "tz_display" DEFAULT 'airport' NOT NULL,
	"theme_override" "theme_pref",
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aircraft" ADD CONSTRAINT "aircraft_aircraft_type_id_aircraft_types_id_fk" FOREIGN KEY ("aircraft_type_id") REFERENCES "public"."aircraft_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_flight_id_flights_id_fk" FOREIGN KEY ("flight_id") REFERENCES "public"."flights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flights" ADD CONSTRAINT "flights_airline_id_airlines_id_fk" FOREIGN KEY ("airline_id") REFERENCES "public"."airlines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flights" ADD CONSTRAINT "flights_departure_airport_id_airports_id_fk" FOREIGN KEY ("departure_airport_id") REFERENCES "public"."airports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flights" ADD CONSTRAINT "flights_arrival_airport_id_airports_id_fk" FOREIGN KEY ("arrival_airport_id") REFERENCES "public"."airports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flights" ADD CONSTRAINT "flights_aircraft_type_id_aircraft_types_id_fk" FOREIGN KEY ("aircraft_type_id") REFERENCES "public"."aircraft_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_flights" ADD CONSTRAINT "manual_flights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_flights" ADD CONSTRAINT "manual_flights_airline_id_airlines_id_fk" FOREIGN KEY ("airline_id") REFERENCES "public"."airlines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_flights" ADD CONSTRAINT "manual_flights_departure_airport_id_airports_id_fk" FOREIGN KEY ("departure_airport_id") REFERENCES "public"."airports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_flights" ADD CONSTRAINT "manual_flights_arrival_airport_id_airports_id_fk" FOREIGN KEY ("arrival_airport_id") REFERENCES "public"."airports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_flights" ADD CONSTRAINT "manual_flights_aircraft_type_id_aircraft_types_id_fk" FOREIGN KEY ("aircraft_type_id") REFERENCES "public"."aircraft_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_flight_id_flights_id_fk" FOREIGN KEY ("flight_id") REFERENCES "public"."flights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_flights" ADD CONSTRAINT "user_flights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_flights" ADD CONSTRAINT "user_flights_flight_id_flights_id_fk" FOREIGN KEY ("flight_id") REFERENCES "public"."flights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "aircraft_registration_key" ON "aircraft" USING btree ("registration");--> statement-breakpoint
CREATE INDEX "aircraft_types_icao_idx" ON "aircraft_types" USING btree ("icao_type");--> statement-breakpoint
CREATE UNIQUE INDEX "airlines_iata_key" ON "airlines" USING btree ("iata");--> statement-breakpoint
CREATE INDEX "airlines_icao_idx" ON "airlines" USING btree ("icao");--> statement-breakpoint
CREATE UNIQUE INDEX "airports_iata_key" ON "airports" USING btree ("iata");--> statement-breakpoint
CREATE INDEX "airports_icao_idx" ON "airports" USING btree ("icao");--> statement-breakpoint
CREATE INDEX "alerts_flight_idx" ON "alerts" USING btree ("flight_id");--> statement-breakpoint
CREATE UNIQUE INDEX "flights_identity_key" ON "flights" USING btree ("airline_id","flight_code","dep_date_key","departure_airport_id","arrival_airport_id");--> statement-breakpoint
CREATE INDEX "flights_sched_dep_idx" ON "flights" USING btree ("scheduled_departure");--> statement-breakpoint
CREATE INDEX "flights_code_date_idx" ON "flights" USING btree ("flight_code","dep_date_key");--> statement-breakpoint
CREATE INDEX "manual_flights_user_idx" ON "manual_flights" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "positions_flight_ts_idx" ON "positions" USING btree ("flight_id","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_flights_one_record_key" ON "user_flights" USING btree ("user_id","flight_id") WHERE "flight_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "user_flights_one_manual_key" ON "user_flights" USING btree ("user_id","manual_flight_id") WHERE "manual_flight_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "user_flights_user_idx" ON "user_flights" USING btree ("user_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");