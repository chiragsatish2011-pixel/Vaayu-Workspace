ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "display_name" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_drive_id" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_file_name" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "has_completed_onboarding" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
