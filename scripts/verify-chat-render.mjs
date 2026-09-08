import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();
import bcrypt from 'bcryptjs';
import { neon } from '@neondatabase/serverless';

const BASE = 'http://localhost:3000';
const EMAIL = `chat_render_check_${Date.now()}@vaayu.test`;
const PASSWORD = `Tmp-${Math.random().toString(36).slice(2)}!xQ9`;
const sql = neon(process.env.DATABASE_URL);

const jar = new Map();
function stashCookies(res) {
  for (const h of res.headers.getSetCookie?.() ?? []) {
    const [pair] = h.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

let userId = null;
try {
  const hash = await bcrypt.hash(PASSWORD, 10);
  const rows = await sql`INSERT INTO users (email, password_hash, role, display_name) VALUES (${EMAIL}, ${hash}, 'member', 'Render Check') RETURNING id`;
  userId = rows[0].id;

  const csrfRes = await fetch(`${BASE}/api/auth/csrf`, { headers: { Cookie: cookieHeader() } });
  stashCookies(csrfRes);
  const { csrfToken } = await csrfRes.json();

  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader() },
    body: new URLSearchParams({ csrfToken, email: EMAIL, password: PASSWORD }),
  });
  stashCookies(loginRes);
  if (![...jar.keys()].some((k) => k.includes('session-token'))) {
    throw new Error(`login failed (status ${loginRes.status})`);
  }
  console.log('login ok');

  const pageRes = await fetch(`${BASE}/chat`, { headers: { Cookie: cookieHeader() } });
  const html = await pageRes.text();
  console.log('chat status:', pageRes.status, '| bytes:', html.length);

  const checks = [
    ['new: Chats heading', html.includes('>Chats<')],
    ['new: New chat action', html.includes('New chat')],
    ['new: conversation search', html.includes('Search chats')],
    ['old eyebrow GONE', !html.includes('Chat — Team')],
    ['old headline GONE', !html.includes('>Chat.<')],
    ['old widget header GONE', !html.includes('>Team Chat<')],
    ['old polling label GONE', !html.includes('live polling')],
  ];
  let fail = 0;
  for (const [name, ok] of checks) {
    console.log(ok ? 'PASS ' : 'FAIL ', name);
    if (!ok) fail++;
  }
  process.exitCode = fail ? 1 : 0;
} catch (e) {
  console.error('RENDER CHECK FAILED:', e?.message ?? e);
  process.exitCode = 1;
} finally {
  if (userId) await sql`DELETE FROM users WHERE id = ${userId}`;
  console.log('temp user cleaned up');
}
