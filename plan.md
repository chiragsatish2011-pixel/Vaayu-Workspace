# Vaayu Workspace — Build Plan (v2: Custom Build on Vercel + Google Drive)

A custom-built team workspace — chat, video/voice calls, and login all built by you — deployed on Vercel, using your Google Drive as the shared file storage layer. Team members log in through your app (not their own Google accounts); the app holds the one connection to your Drive on everyone's behalf.

**Team size:** 3–10 people
**Deploy target:** Vercel (serverless — see constraints below)
**Storage:** Your Google Drive, accessed only through your app's backend
**Auth model:** App-level login (email/password or magic link) — you control accounts; team never touches your Google account directly
**Budget:** $0 to start, using free tiers of every helper service

---

## 1. The one constraint that shapes everything: Vercel is serverless

Vercel runs your code as short-lived functions — they spin up, respond, and shut down. There's no "always-on process" the way a traditional server has. This is perfect for your login system and API routes, but chat and video calling normally need a persistent, always-open connection between users. Building that persistent layer yourself, hosted directly on Vercel, will time out and fail in production no matter how well it's coded — this isn't a skill gap, it's a platform limitation every serverless chat/video app runs into.

The fix every serverless app uses: Vercel hosts your app's logic and UI, and a small free real-time service handles just the "keep a connection open" part. You still design and build the entire chat and call experience — the helper service is invisible plumbing, not a replacement product.

| Piece | Runs on Vercel? | What handles the real-time part |
|---|---|---|
| Login/auth | Yes, natively | — (no persistent connection needed) |
| Google Drive connection | Yes, natively | — (short API calls only) |
| Chat (message delivery) | UI + API only | Pusher or Ably (free tier) for the live socket |
| Video/voice calls | UI + signaling only | LiveKit Cloud or Daily.co (free tier) for media relay |

---

## 2. Architecture overview

```
                         ┌───────────────────────────┐
                         │   Vaayu Workspace (Vercel) │
                         │   Next.js app, API routes  │
                         └──────────────┬─────────────┘
                                        │
        ┌───────────────┬──────────────┼───────────────┬─────────────────┐
        │               │              │               │                 │
┌───────┴──────┐ ┌──────┴───────┐ ┌────┴──────┐ ┌───────┴───────┐ ┌───────┴───────┐
│  App login    │ │  Google Drive │ │  Pusher/  │ │  LiveKit/     │ │  Postgres      │
│  (NextAuth,   │ │  API (server- │ │  Ably     │ │  Daily.co     │ │  (Neon/Supabase│
│  credentials  │ │  side, your   │ │  (chat    │ │  (video/voice │ │  free tier —   │
│  or magic     │ │  refresh      │ │  realtime │ │  signaling +  │ │  users, chat   │
│  link)        │ │  token only)  │ │  layer)   │ │  media relay) │ │  history, roles│
└───────────────┘ └───────────────┘ └───────────┘ └───────────────┘ └────────────────┘
```

**Why a small Postgres database too:** Google Drive stores *files*, but your app still needs somewhere to store things that aren't files — user accounts, chat message history, project metadata (name/description/tags/preview image reference), who's in which project, permissions. Trying to store those as Drive files would be slow and fragile (this was the issue flagged earlier). A free-tier Postgres (Neon or Supabase, both have generous free tiers and work natively with Vercel) handles that cleanly, while actual project files/folders and code packages live in your Drive. This keeps "your Drive is the file storage" fully true, without forcing structured app data into a system not built for it.

---

## 3. Component choices

| Need | Tool | Cost | Why |
|---|---|---|---|
| Hosting | Vercel | Free tier | Your deploy target |
| Frontend/backend framework | Next.js | Free | Vercel's native framework, API routes built in |
| App login | NextAuth.js (Credentials or Email provider) | Free | Built for Next.js/Vercel, handles sessions/JWT |
| App database (users, chat history, roles) | Neon or Supabase Postgres | Free tier | Serverless-friendly, works natively with Vercel |
| File storage | Google Drive API | Free (15GB) or your paid 2TB plan | Accessed server-side only, via your OAuth refresh token |
| Chat real-time layer | Pusher or Ably | Free tier | Handles the persistent connection Vercel can't |
| Video/voice calls | LiveKit Cloud or Daily.co | Free tier | Handles signaling + media relay for calls |
| File uploads UI | Google Drive Picker / Drive API upload | Free | Lets users browse/upload within your Drive from your app |

---

## 4. Phased build plan

### Phase 0 — Project setup
- Create a Next.js app, push to a GitHub repo, connect it to Vercel for auto-deploy on push.
- Set up a free Neon or Supabase Postgres database, connect via environment variables in Vercel.
- **Outcome:** A live, deployed "Hello World" app on Vercel with a working database connection.

### Phase 1 — Login system
- Add NextAuth.js with a Credentials provider (email/password) or Email magic-link provider.
- Create a `users` table in Postgres (id, email, password hash or magic-link token, role: admin/member).
- Build sign-up/sign-in pages; protect all other routes behind a valid session.
- **Outcome:** Team members can create accounts and log into Vaayu Workspace — no Google account needed on their end.

### Phase 2 — Google Drive connection (server-side only)
- Set up a Google Cloud project, enable the Drive API, create OAuth credentials.
- You (the owner) authorize the app once — this generates a refresh token, stored as a Vercel environment variable/secret, never exposed to the browser.
- Build API routes (`/api/drive/list`, `/api/drive/upload`, `/api/drive/download`) that use that server-side token to act on your Drive on behalf of any logged-in team member.
- Build a simple file browser UI: list folders/files, upload, download, delete — all going through your API routes, never directly from the browser to Google.
- Add compression on upload: before sending a file (or folder, zipped client-side or server-side) to Drive, compress it (e.g. zip for folders/project bundles) so storage is used efficiently — this was one of your original requirements and fits naturally here.
- **Outcome:** Any logged-in team member can browse, upload (with compression), and manage files in your Drive through your app, without ever seeing your Google credentials.

### Phase 2b — Code sharing as compressed project packages
- Code is not version-controlled here — it's shared as compressed project bundles, matching your workflow: someone zips a codebase, uploads it with a description form, others browse and download.
- Build an "Upload project" form: project name, description, project type/tags, optional preview image upload, and the compressed codebase file (zip/tar.gz) itself.
- On submit: the preview image and compressed code file both upload to your Drive (via the same server-side Drive API routes from Phase 2); the form's metadata (name, description, tags, uploader, timestamp, Drive file ID for both the code archive and preview image) saves to a `projects` table in Postgres.
- Build a "Projects" browse page: cards showing preview image, name, description, uploader, and a Download button — clicking it calls an API route that fetches the file from Drive server-side and streams it to the user (so the user never touches your Drive directly or needs their own Drive access).
- Compression itself: since the user compresses before upload in this flow, the app's job is validating the upload (e.g. accept `.zip`/`.tar.gz`, reasonable size limit) rather than compressing server-side — keep this in mind so opencode doesn't build unnecessary server-side compression logic here (compression on Phase 2's general file uploads is still separate and still applies).
- **Outcome:** Teammates can publish a described, previewable project package and others can discover and download it — all backed by your Drive, no direct Drive access required by anyone but you.

**Note on version control:** this flow (manual zip + upload + form) does not give you diffs, merge conflict handling, or history the way Git would — each upload is a new snapshot/version of a project package, not a tracked codebase. That's a deliberate tradeoff per your workflow, not an oversight; if you later want real version history, the Postgres `projects` table can simply store multiple versions per project (v1, v2, ...) with the same download flow, without needing Git at all.

### Phase 3 — Chat system
- Sign up for Pusher or Ably free tier; add their SDK to your Next.js app.
- Create a `messages` table in Postgres (sender, channel, content, timestamp) for history.
- Build channels (e.g. per-project), a message input, and a live message feed: new messages save to Postgres via an API route, then broadcast instantly to other users via Pusher/Ably.
- **Outcome:** Real-time team chat, fully working on Vercel, with persistent history.

### Phase 4 — Voice/video calls
- Sign up for LiveKit Cloud or Daily.co free tier.
- Build a "Start call" button per channel/project that creates a room via their API and gives each participant a join link/token.
- Embed their prebuilt call UI component (both providers offer one) or build a lighter custom UI on top of their SDK.
- **Outcome:** One-click voice/video calls between team members, launched from inside Vaayu Workspace.

### Phase 5 — Polish and permissions
- Add roles (admin can invite/remove members, manage folders; members have standard access).
- Add an invite-by-email flow so you control who can create an account.
- Style the dashboard: one landing page after login showing recent files, active channels, and a "start call" shortcut.
- **Outcome:** A cohesive, branded "Vaayu Workspace" experience, not just three separate features bolted together.

### Phase 6 — Hardening
- Rate-limit API routes (especially Drive and auth) to avoid abuse.
- Add error boundaries and logging (Vercel's built-in logs, or a free tier of Sentry) so failures are visible, not silent.
- Set environment variables for production vs. preview deploys correctly in Vercel to avoid the "works locally, breaks in prod" class of errors.
- Security specifics (explicit, not implied):
  - Hash passwords with bcrypt or argon2 — never store plaintext, ever, even temporarily.
  - Use NextAuth's built-in secure session handling (JWT or database sessions) with a strong `NEXTAUTH_SECRET`.
  - Enforce HTTPS-only cookies (`secure: true`) — Vercel provides HTTPS by default, make sure cookies require it too.
  - Validate and sanitize all file names/paths before they touch the Drive API to prevent path traversal or injection.
- Test the full flow (signup → login → Drive browse/upload → chat → call → code repo link) end-to-end before rolling out to your team.
- **Outcome:** A production deployment you can trust, with visibility when something does go wrong, and no obvious security gaps.

---

## 5. Where opencode fits in

opencode can meaningfully speed up nearly every phase here since it's all custom code:
- Scaffolding the Next.js app structure and API routes.
- Writing the NextAuth.js configuration and Postgres schema/migrations.
- Writing the Google Drive API integration (OAuth flow, list/upload/download routes).
- Wiring up the Pusher/Ably and LiveKit/Daily SDKs.
- Debugging Vercel-specific issues (env vars, serverless function limits, cold starts).

---

## 6. Key things to avoid (the "zero production errors" list)

- **Never** expose your Google Drive refresh token or client secret to the browser — it must only be read inside server-side API routes/environment variables.
- **Don't** try to hold a raw WebSocket or WebRTC connection directly inside a Vercel serverless function — it will work in local dev and fail in production. Always route real-time traffic through Pusher/Ably/LiveKit/Daily.
- **Don't** store large files or chat history as Drive files — keep Drive for actual team documents/project files, and Postgres for structured app data.
- **Watch free-tier limits**: Google Drive API has daily quota limits, Pusher/Ably/LiveKit free tiers cap concurrent connections/minutes. Fine for a 3–10 person team's daily use, but worth checking each provider's current free-tier numbers before rollout.
- **Set environment variables in Vercel's dashboard**, not hardcoded — this is the single most common source of "works on my machine, breaks on Vercel" errors.

---

## 7. Suggested timeline

| Phase | Estimated time (part-time, with opencode assisting) |
|---|---|
| 0 (project setup) | 1 day |
| 1 (login) | 1–2 days |
| 2 (Drive connection + compression) | 2–3 days |
| 2b (code repo integration) | 1 day |
| 3 (chat) | 2–3 days |
| 4 (calls) | 2–3 days |
| 5 (polish/permissions) | 2–3 days |
| 6 (hardening) | 1–2 days |

Total to a working v1: roughly **2–3 weeks** part-time — longer than the self-hosted-tools version, because you're genuinely building chat, calls, and auth yourself rather than deploying existing software, but it fits your Vercel + Drive requirement exactly.

---

## 8. Next steps

1. Confirm which free real-time providers to use: Pusher vs. Ably (chat), LiveKit Cloud vs. Daily.co (video) — quick free-tier comparison worth doing before Phase 3/4.
2. Set up the Google Cloud project and OAuth credentials early (Phase 2) since approval/setup can take a little back-and-forth.
3. Start with Phase 0–1 to get something live on Vercel fast, then layer in Drive, chat, and calls.
4. Keep Phase 6 (hardening) checks running continuously, not just at the end — check env vars and error logs after every deploy.
