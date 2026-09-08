-- WhatsApp-style conversations: private 1:1 DMs + scoped group chats.
-- Every message belongs to exactly one conversation; visibility is enforced
-- at the query level via conversation_participants (never client-side).
-- Idempotent: safe to run multiple times (IF NOT EXISTS guards).
-- Applied to Neon via scripts/migrate-chat-conversations.mjs (live DB
-- predates drizzle-kit migrate, so this file is the record, not the runner).

CREATE TYPE "public"."conversation_type" AS ENUM('direct', 'group');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "conversation_type" NOT NULL,
	"name" text,
	"created_by" uuid REFERENCES "public"."users"("id") ON DELETE set null,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversation_participants" (
	"conversation_id" uuid NOT NULL REFERENCES "public"."conversations"("id") ON DELETE cascade,
	"user_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_read_at" timestamp with time zone,
	CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("conversation_id", "user_id")
);--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "conversation_id" uuid REFERENCES "public"."conversations"("id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_messages_conversation_created_idx" ON "chat_messages" ("conversation_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_participants_user_idx" ON "conversation_participants" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_updated_idx" ON "conversations" ("updated_at" DESC);
