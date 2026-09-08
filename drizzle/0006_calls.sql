CREATE TYPE IF NOT EXISTS "call_type" AS ENUM('voice', 'video');
CREATE TYPE IF NOT EXISTS "call_context" AS ENUM('standalone', 'project', 'checkpoint');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "call_type" NOT NULL,
	"context" "call_context" DEFAULT 'standalone' NOT NULL,
	"context_id" text,
	"daily_room_name" text NOT NULL,
	"daily_room_url" text NOT NULL,
	"created_by" uuid REFERENCES "public"."users"("id") ON DELETE set null,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "calls_daily_room_name_unique" ON "calls" ("daily_room_name");
