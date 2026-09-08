ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "department" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "job_title" text;
--> statement-breakpoint
