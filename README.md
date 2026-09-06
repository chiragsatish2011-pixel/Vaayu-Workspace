# Vaayu Workspace (Phase 0–1)

Custom team workspace for a 3–10 person team. **Phase 0–1 only:** project
scaffold, Postgres schema, email/password auth (NextAuth Credentials), and a
minimal dashboard shell. Chat, video/calls, and Drive integration come in later
phases and intentionally do not exist in this codebase yet.

## Tech stack (exact)

- Next.js (App Router) + TypeScript + Tailwind CSS
- NextAuth.js v4 — Credentials provider (email + password), JWT sessions
- Postgres via Neon serverless driver (`@neondatabase/serverless` HTTP driver —
  one fetch per query, no connection pool, safe for Vercel serverless)
- Drizzle ORM (`drizzle-orm` + `drizzle-kit`) for schema and migrations
- bcryptjs for password hashing (never plaintext)

## Design system

Synthesized from `DESIGN-cohere.md`, `DESIGN-minimax.md` and
`traderview.design.md` (see `app/globals.css` for tokens):

- White canvas, near-black pill CTAs, hairline borders, flat surfaces.
- Space Grotesk display + Inter body + mono micro-labels.
- One vibrant identity color per section (never for generic UI):
  Files `#1456f0` · Projects `#ff5530` · Chat `#a855f7` · Calls `#22ab94`.
- Deep-pine (`#003c33`) brand panel on auth pages; black announcement bar.
- CSS-only animation (no library): staggered entrances, scroll reveals,
  animated gradients, sheen sweeps, marquee band, pulsing status dots —
  all disabled under `prefers-reduced-motion`.

## Prerequisites

- Node.js 20+ and npm
- A Neon Postgres project (this workspace is linked to `dry-frost-39520544`,
  branch `production`) — grab its **pooled** connection string from the Neon
  dashboard → Connect
- Optional for deploys: a Vercel account + a GitHub repo

## Environment variables

| Name | Used for | Example |
|---|---|---|
| `DATABASE_URL` | Neon **pooled** Postgres URL (runtime queries + migrations). Must be the pooler host (`…-pooler.…`), never a direct connection — serverless functions would exhaust a normal pool. | `postgresql://USER:PASSWORD@HOST-pooler/DB?sslmode=require` |
| `NEXTAUTH_SECRET` | Signs JWT sessions (`openssl rand -base64 32`) | any strong random string |
| `NEXTAUTH_URL` | Public app URL (callbacks/redirects) | `http://localhost:3000` locally, `https://YOUR-APP.vercel.app` in prod |

That's all three — there are no other variables to set. Every secret comes
from the environment — there are zero hardcoded secrets in the codebase.

They must be set in Vercel's dashboard (**Project Settings → Environment
Variables**) separately from any local `.env` file, for **Production**,
**Preview**, and **Development**. A local `.env.local` never deploys —
if a variable is missing in Vercel, production breaks even when local dev
works.

Missing variables fail fast with a loud error naming the exact variable
(checked on first database/auth access, via `lib/env.ts` — `next build`
still succeeds without them so CI stays green):

- `DATABASE_URL is not set. Add it in Vercel's Environment Variables settings for this environment.`
- `NEXTAUTH_SECRET is not set. Add it in Vercel's Environment Variables settings for this environment.`
- `NEXTAUTH_URL is not set. Add it in Vercel's Environment Variables settings for this environment.`

The `/setup` wizard is the only flow that works without `DATABASE_URL`
(step 1 collects it); everything else throws the above instead of failing
later with a generic 500.

## Team-only access (no public registration)

There is **no sign-up page**, and users have **no self-service password
UI at all** — only admins control credentials:

- **First account:** seed it directly (see below), or use the `/setup`
  wizard which creates the owner as `admin` (and refuses once any user
  exists — it can never hijack a live workspace).
- **Everyone else:** an admin creates them at **Admin → New account**
  (sidebar, admins only) with a password the admin types. The password
  is shown **once** in a copy box — share it privately.
- **Changes & removals:** on that same admin page, each team row has
  **Change password** (new password, no current-password needed) and
  **Delete** (admins can't delete their own account).
- Members just sign in and land on the dashboard. **Settings** is a
  read-only account summary — password help goes through the admin.

## Seed the first admin

```bash
DATABASE_URL="postgresql://..." npm run db:seed
# or with DATABASE_URL in .env.local: npm run db:seed
```

Creates (or updates to admin) `admin@vaayu.com` / `1234` — a
**placeholder credential**. Change it immediately after signing in via
**Admin → Change password** on your own row. Login lowercases emails,
so `Admin@vaayu.com` works too.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000/setup and follow the 3-step wizard — database,
tables, owner account — all in the browser. (Manual alternative: paste
`DATABASE_URL` into `.env.local` and run `npm run db:migrate`.)

Then:

1. Seed the admin (`npm run db:seed`, see above) or run the `/setup`
   wizard to create tables + owner.
2. Sign in at `/signin` — you land directly on the dashboard.
3. As admin, create member accounts at **Admin → New account** — share
   each password privately; it's shown once and never stored.
4. Members sign straight into the dashboard (Files / Projects / Chat /
   Calls placeholders) plus read-only **Settings**.
5. Sign out via the sidebar button.

Verify hashing: check the `users` table — `password_hash` holds a `$2b$…`
bcrypt hash, never the plaintext password.

## Project structure

```
app/
  page.tsx                    dashboard (protected)
  signin/page.tsx             sign-in (public, no registration links)
  settings/page.tsx           read-only account summary (protected, no password UI)
  admin/page.tsx              full credential control: create/change-password/delete (admin only)
  setup/page.tsx              first-run wizard: DB, tables, owner (public until done)
  files|projects|chat|calls/  "Coming soon" placeholders
  api/auth/[...nextauth]/     NextAuth handler (GET+POST)
  api/admin/users/            admin-only create (POST) / change password (PATCH) / delete (DELETE), bcrypt
  api/setup/*/                wizard endpoints (status/database/migrate/owner)
components/  AppShell, SectionMatrix, AuthLayout, ComingSoon, CreateAccountForm, UserRowActions, …
lib/auth.ts  NextAuth options (JWT Sessions, secure cookies)
lib/session.ts  requireActiveSession / requireAdmin route guards
db/          schema.ts (users table) + index.ts (stateless Neon HTTP client)
scripts/     seed-admin.mjs (one-time first-admin bootstrap, run via db:seed)
drizzle/     SQL migrations (apply with db:migrate)
middleware.ts  withAuth route protection → redirects to /signin
```

## Deploy to Vercel

No `vercel.json` needed — Next.js deploys with zero extra config.

1. Push this folder to a GitHub repo (`main` branch).
2. Vercel → Add New Project → import the repo (framework preset: Next.js).
3. In **Project Settings → Environment Variables**, set exactly these —
   per environment:

   | Variable | Production | Preview | Development |
   |---|---|---|---|
   | `DATABASE_URL` | Neon **pooled** URL (`…-pooler.…?sslmode=require`) | Same value (or a Neon preview-branch URL) | `http://localhost` use only via local `.env.local`, not Vercel |
   | `NEXTAUTH_SECRET` | Strong random (`openssl rand -base64 32`), production-only | Can reuse Production's value | Local `.env.local` only |
   | `NEXTAUTH_URL` | `https://YOUR-APP.vercel.app` — your real deployed URL | **Do NOT set** — NextAuth auto-detects Vercel preview URLs; a static value here breaks callbacks | `http://localhost:3000` |

   ⚠️ `NEXTAUTH_URL` must be the real deployed URL, not localhost — auth
   breaks otherwise. If you add a **custom domain later, update
   `NEXTAUTH_URL` to it and redeploy**, or sign-in callbacks will fail.
4. Deploy. Vercel runs `npm run build` (`next build`).
5. After deploy, open `https://YOUR-APP.vercel.app/setup` in the browser
   to create tables + owner account (set `DATABASE_URL` first, then the
   wizard; no terminal needed).

Database on Vercel: the app uses Neon's HTTP driver — every API route is
stateless and completes quickly (no long-lived connections, no in-memory
session store, no background workers), so it fits Vercel's serverless model.
Later phases will use Pusher/Ably (chat) and LiveKit/Daily (calls) for the
persistent-connection parts — nothing in this phase tries to hold sockets
open on Vercel.

## Scripts

- `npm run dev` / `npm run build` / `npm start` — standard Next.js
- `npm run db:generate` — regenerate SQL from `db/schema.ts`
- `npm run db:migrate` — apply `drizzle/` migrations (needs `DATABASE_URL`)
- `npm run db:push` — quick prototype sync (needs `DATABASE_URL`)
- `npm run db:seed` — create/update the first admin (`admin@vaayu.com`, needs `DATABASE_URL`)

## Security notes

- Passwords hashed with bcrypt (cost 12) via bcryptjs; plaintext never stored
  or logged. Minimum password length 8 enforced server-side on the admin
  panel (the one-time seed uses a placeholder that must be changed
  immediately). Passwords shown in the admin UI appear once and never
  touch logs or storage.
- NextAuth JWT strategy with `NEXTAUTH_SECRET` from env; session cookie is
  `httpOnly` and `Secure` in production (`__Secure-` prefix).
- `middleware.ts` guards all routes except `/signin`, `/setup`,
  `/api/auth/*`, `/api/setup/*`, and static assets. There is no public
  registration route at all.
- Failures log with route context (`[auth][authorize]`, `[admin/users]`,
  `[setup/*]`, `[seed-admin]`) — check Vercel → Project → Logs →
  Functions when production misbehaves.

## Deliberately out of scope (later phases)

No chat, video/voice, or Google Drive code exists yet — no Pusher/Ably,
LiveKit/Daily, Drive API, pickers, or upload routes. The top-nav sections
reserve their URLs only.
