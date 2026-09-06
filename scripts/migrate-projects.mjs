import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

console.log("Applying projects table migration...");
await sql`
  CREATE TABLE IF NOT EXISTS "projects" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade,
    "title" text NOT NULL,
    "description" text NOT NULL,
    "codebase_drive_id" text NOT NULL,
    "codebase_file_name" text NOT NULL,
    "codebase_file_size" text NOT NULL,
    "preview_drive_id" text,
    "preview_file_name" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  );
`;
console.log("Projects table migration applied successfully!");
