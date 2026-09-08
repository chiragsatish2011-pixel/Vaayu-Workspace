CREATE TABLE IF NOT EXISTS "scheduled_meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"organizer_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade,
	"start_time" timestamp with time zone NOT NULL,
	"duration_minutes" integer DEFAULT 30 NOT NULL,
	"call_type" "call_type" NOT NULL,
	"rrule" text,
	"invitee_ids" text DEFAULT '[]' NOT NULL,
	"project_id" uuid REFERENCES "public"."projects"("id") ON DELETE set null,
	"excluded_dates" text DEFAULT '[]' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
