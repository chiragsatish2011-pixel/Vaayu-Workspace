import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
const u = await sql`SELECT count(*)::int AS c FROM users WHERE email LIKE '%vaayu.test'`;
const c = await sql`SELECT count(*)::int AS c FROM conversations`;
const m = await sql`SELECT count(*)::int AS c FROM chat_messages WHERE conversation_id IS NULL`;
console.log('leftover test users:', u[0].c, '| total conversations:', c[0].c, '| legacy global msgs:', m[0].c);
