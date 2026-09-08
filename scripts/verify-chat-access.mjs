import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
const sql = neon(url);

const tag = `chat_verify_${Date.now()}`;
const results = [];
function check(name, cond) {
  results.push([cond ? 'PASS' : 'FAIL', name]);
  if (!cond) process.exitCode = 1;
}

try {
  // 1. Temp users: A, B (DM pair) + outsider C.
  const au = await sql`INSERT INTO users (email, password_hash, role) VALUES (${tag + '_a@vaayu.test'}, 'x', 'member') RETURNING id`;
  const bu = await sql`INSERT INTO users (email, password_hash, role) VALUES (${tag + '_b@vaayu.test'}, 'x', 'member') RETURNING id`;
  const cu = await sql`INSERT INTO users (email, password_hash, role) VALUES (${tag + '_outsider@vaayu.test'}, 'x', 'member') RETURNING id`;
  const [A, B, C] = [au[0].id, bu[0].id, cu[0].id];

  // 2. Direct conversation A<->B.
  const dm = await sql`INSERT INTO conversations (type, created_by) VALUES ('direct', ${A}) RETURNING id`;
  const dmId = dm[0].id;
  await sql`INSERT INTO conversation_participants (conversation_id, user_id) VALUES (${dmId}, ${A}), (${dmId}, ${B})`;
  await sql`INSERT INTO chat_messages (conversation_id, user_id, content) VALUES (${dmId}, ${A}, 'hello B')`;

  // 3. Membership checks = EXACTLY what lib/chat-access isParticipant() runs.
  const isPart = async (cid, uid) =>
    (await sql`SELECT 1 FROM conversation_participants WHERE conversation_id = ${cid} AND user_id = ${uid} LIMIT 1`).length > 0;
  check('A is participant of DM', await isPart(dmId, A));
  check('B is participant of DM', await isPart(dmId, B));
  check('OUTSIDER is NOT participant of DM', !(await isPart(dmId, C)));

  // 4. Sidebar scoping = EXACTLY what GET /api/chat/conversations runs.
  const listFor = async (uid) =>
    (await sql`SELECT conversation_id FROM conversation_participants WHERE user_id = ${uid}`).map((r) => r.conversation_id);
  check('A list contains DM', (await listFor(A)).includes(dmId));
  check('outsider list EXCLUDES DM', !(await listFor(C)).includes(dmId));

  // 5. Message read scoping: outsider-joined query returns zero rows.
  const msgsFor = async (cid, uid) =>
    await sql`SELECT m.id FROM chat_messages m JOIN conversation_participants p ON p.conversation_id = m.conversation_id AND p.user_id = ${uid} WHERE m.conversation_id = ${cid}`;
  check('A reads 1 message', (await msgsFor(dmId, A)).length === 1);
  check('outsider reads 0 messages', (await msgsFor(dmId, C)).length === 0);

  // 6. Group with 3 members; outsider excluded.
  const g = await sql`INSERT INTO conversations (type, name, created_by) VALUES ('group', 'verify group', ${A}) RETURNING id`;
  const gId = g[0].id;
  await sql`INSERT INTO conversation_participants (conversation_id, user_id) VALUES (${gId}, ${A}), (${gId}, ${B}), (${gId}, ${C})`;
  const du = await sql`INSERT INTO users (email, password_hash, role) VALUES (${tag + '_d@vaayu.test'}, 'x', 'member') RETURNING id`;
  const D = du[0].id;
  check('group member C is participant', await isPart(gId, C));
  check('non-member D is NOT participant', !(await isPart(gId, D)));
  check('non-member D list excludes group', !(await listFor(D)).includes(gId));

  // 7. DM dedupe logic: exactly one direct convo for pair A-B.
  const pairCount = await sql`SELECT c.id FROM conversations c
    JOIN conversation_participants p1 ON p1.conversation_id = c.id AND p1.user_id = ${A}
    JOIN conversation_participants p2 ON p2.conversation_id = c.id AND p2.user_id = ${B}
    WHERE c.type = 'direct'
    AND NOT EXISTS (SELECT 1 FROM conversation_participants px WHERE px.conversation_id = c.id AND px.user_id NOT IN (${A}, ${B}))`;
  check('exactly 1 direct convo for pair', pairCount.length === 1);

  console.log(results.map(([s, n]) => `${s}  ${n}`).join('\n'));
} finally {
  // Cleanup everything created above.
  await sql.query(`DELETE FROM users WHERE email LIKE '${tag}%@vaayu.test'`);
  // Conversations created by temp users cascade via participants? No — delete explicitly.
  await sql.query(`DELETE FROM conversations WHERE id NOT IN (SELECT conversation_id FROM conversation_participants)`);
  console.log('cleanup done');
}
