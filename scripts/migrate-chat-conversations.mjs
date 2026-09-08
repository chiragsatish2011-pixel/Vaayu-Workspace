import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
const sql = neon(url);

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "conversations" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "type" "conversation_type" NOT NULL,
    "name" text,
    "created_by" uuid REFERENCES "public"."users"("id") ON DELETE set null,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "conversation_participants" (
    "conversation_id" uuid NOT NULL REFERENCES "public"."conversations"("id") ON DELETE cascade,
    "user_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade,
    "joined_at" timestamp with time zone DEFAULT now() NOT NULL,
    "last_read_at" timestamp with time zone,
    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("conversation_id", "user_id")
  )`,
  `ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "conversation_id" uuid REFERENCES "public"."conversations"("id") ON DELETE cascade`,
  `CREATE INDEX IF NOT EXISTS "chat_messages_conversation_created_idx" ON "chat_messages" ("conversation_id", "created_at")`,
  `CREATE INDEX IF NOT EXISTS "conversation_participants_user_idx" ON "conversation_participants" ("user_id")`,
  `CREATE INDEX IF NOT EXISTS "conversations_updated_idx" ON "conversations" ("updated_at" DESC)`,
];

try {
  // Enum first (no IF NOT EXISTS for types on older PG; guard via catalog).
  // NOTE: schema.ts declares conversation_type as a pgEnum, but the live DB
  // predates drizzle migrations, so we store type as TEXT + CHECK instead of
  // a native enum to stay idempotent. The CHECK enforces the same domain.
  // Native enum to match db/schema.ts (conversationTypeEnum). Guarded via catalog.
  const hasType = await sql`SELECT 1 FROM pg_type WHERE typname = 'conversation_type'`;
  if (hasType.length === 0) {
    await sql.query(`CREATE TYPE "public"."conversation_type" AS ENUM('direct', 'group')`);
    console.log('ok: created enum conversation_type');
  } else {
    console.log('ok: enum conversation_type already exists');
  }

  const existing = await sql`SELECT to_regclass('public.conversations') as tbl`;
  console.log('before:', existing);

  for (const stmt of STATEMENTS) {
    await sql.query(stmt);
    console.log('ok:', stmt.slice(0, 60).replace(/\s+/g, ' '));
  }

  const tables = await sql`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('conversations','conversation_participants','chat_messages') ORDER BY tablename`;
  console.log(tables);
  const cols = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='chat_messages' ORDER BY ordinal_position`;
  console.log(cols);
} catch (e) {
  console.error('MIGRATION FAILED:', e);
  process.exit(1);
}
