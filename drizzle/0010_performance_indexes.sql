CREATE INDEX IF NOT EXISTS "projects_user_id_idx" ON "projects" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_created_at_idx" ON "projects" USING btree ("created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_messages_user_id_idx" ON "chat_messages" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calls_created_by_idx" ON "calls" USING btree ("created_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calls_expires_at_idx" ON "calls" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_meetings_organizer_idx" ON "scheduled_meetings" USING btree ("organizer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_meetings_start_time_idx" ON "scheduled_meetings" USING btree ("start_time");
