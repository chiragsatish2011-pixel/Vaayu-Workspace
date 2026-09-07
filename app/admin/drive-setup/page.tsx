import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/Badge";
import { CheckpointsSheetSetup } from "@/components/CheckpointsSheetSetup";
import { Reveal } from "@/components/Reveal";
import { requireAdmin } from "@/lib/session";

export const runtime = "nodejs";

export default async function DriveSetupPage() {
  const user = await requireAdmin();

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;

  const hasClientId = Boolean(clientId && clientId.trim().length > 0);
  const hasClientSecret = Boolean(clientSecret && clientSecret.trim().length > 0);
  const hasRefreshToken = Boolean(refreshToken && refreshToken.trim().length > 0);
  const spreadsheetId = process.env.GOOGLE_SHEETS_CHECKPOINTS_ID;
  const hasSpreadsheetId = Boolean(
    spreadsheetId && spreadsheetId.trim().length > 0
  );

  const isComplete = hasClientId && hasClientSecret && hasRefreshToken;

  return (
    <AppShell user={{ email: user.email, role: user.role }} active="/admin">
      <section className="pt-10 sm:pt-14 pb-16">
        <div className="flex items-center gap-2">
          <Link
            href="/admin"
            className="font-mono text-xs uppercase tracking-[0.24em] text-stone hover:text-ink transition-colors"
          >
            ← Admin
          </Link>
          <span className="font-mono text-xs text-stone">/</span>
          <span className="font-mono text-xs uppercase tracking-[0.24em] text-stone">
            Drive Setup
          </span>
        </div>

        <h1
          className="mt-3 max-w-2xl animate-fade-up font-display text-4xl font-bold leading-[1.02] tracking-[-0.02em] sm:text-5xl"
          style={{ animationDelay: "90ms" }}
        >
          Google Drive Storage
        </h1>
        <p
          className="mt-4 max-w-2xl animate-fade-up text-[15px] leading-relaxed text-steel"
          style={{ animationDelay: "160ms" }}
        >
          Authorize your Google account once to enable backend storage for project
          files of any type, entire folder trees, and preview files in the Projects section —
          plus the Google Sheet that stores the Checkpoints timeline. All reads
          and writes run server-side — your credentials are never exposed.
        </p>

        {/* Status Card */}
        <div className="mt-8">
          <Reveal className="rounded-2xl border border-hairline bg-canvas p-6 sm:p-8">
            <div className="flex items-center justify-between pb-5 border-b border-hairline-soft">
              <div>
                <h2 className="font-display text-xl font-bold tracking-tight">
                  Configuration Status
                </h2>
                <p className="mt-1 text-xs text-steel">
                  Environment variables required for Drive backend operations
                </p>
              </div>
              <Badge tone={isComplete ? "live" : "phase"}>
                {isComplete ? "Ready" : "Pending Setup"}
              </Badge>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-hairline-soft bg-fog p-4">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold uppercase tracking-wider text-stone">
                    Client ID
                  </span>
                  <Badge tone={hasClientId ? "live" : "phase"}>
                    {hasClientId ? "Set" : "Missing"}
                  </Badge>
                </div>
                <p className="mt-2 font-mono text-xs text-steel truncate">
                  GOOGLE_CLIENT_ID
                </p>
              </div>

              <div className="rounded-xl border border-hairline-soft bg-fog p-4">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold uppercase tracking-wider text-stone">
                    Client Secret
                  </span>
                  <Badge tone={hasClientSecret ? "live" : "phase"}>
                    {hasClientSecret ? "Set" : "Missing"}
                  </Badge>
                </div>
                <p className="mt-2 font-mono text-xs text-steel truncate">
                  GOOGLE_CLIENT_SECRET
                </p>
              </div>

              <div className="rounded-xl border border-hairline-soft bg-fog p-4">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold uppercase tracking-wider text-stone">
                    Refresh Token
                  </span>
                  <Badge tone={hasRefreshToken ? "live" : "phase"}>
                    {hasRefreshToken ? "Set" : "Missing"}
                  </Badge>
                </div>
                <p className="mt-2 font-mono text-xs text-steel truncate">
                  GOOGLE_DRIVE_REFRESH_TOKEN
                </p>
              </div>
            </div>

            {hasClientId && hasClientSecret && (
              <div className="mt-6 pt-5 border-t border-hairline-soft flex items-center justify-between flex-wrap gap-4">
                <div>
                  <p className="text-sm font-semibold text-ink">
                    {hasRefreshToken ? "Re-authorize Drive" : "Authorize your Drive account"}
                  </p>
                  <p className="text-xs text-steel mt-0.5">
                    Opens Google OAuth consent screen to mint or refresh the token.
                    {hasRefreshToken && (
                      <>
                        {" "}If you authorized before the Checkpoints feature existed, re-authorize — Google must also grant the Sheets permission.
                      </>
                    )}
                  </p>
                </div>
                <a
                  href="/api/drive/oauth/start"
                  className="inline-flex items-center gap-2 rounded-full bg-ink px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
                >
                  {hasRefreshToken ? "Re-authorize with Google" : "Authorize with Google →"}
                </a>
              </div>
            )}
          </Reveal>
        </div>

        {/* Step-by-Step Guide */}
        <div className="mt-10">
          <Reveal delay={50} className="rounded-2xl border border-hairline bg-canvas p-6 sm:p-8">
            <div className="flex items-center justify-between gap-4 border-b border-hairline-soft pb-5">
              <div>
                <h2 className="font-display text-xl font-bold tracking-tight">
                  Checkpoints Sheet
                </h2>
                <p className="mt-1 text-xs text-steel">
                  One click verifies or creates the sheet — no manual steps needed.
                  Safe to re-run: a healthy sheet is left untouched, never duplicated.
                </p>
              </div>
              <Badge tone={hasSpreadsheetId ? "live" : "phase"}>
                {hasSpreadsheetId ? "ID saved" : "No ID saved"}
              </Badge>
            </div>
            <CheckpointsSheetSetup />
          </Reveal>
        </div>

        {/* Manual fallback (only needed if the automatic setup above fails) */}
        <div className="mt-10">
          <Reveal delay={75} className="rounded-2xl border border-hairline bg-canvas p-6 sm:p-8">
            <div className="flex items-center justify-between gap-4 border-b border-hairline-soft pb-5">
              <div>
                <h2 className="font-display text-xl font-bold tracking-tight">
                  Manual Sheet Setup (fallback)
                </h2>
                <p className="mt-1 text-xs text-steel">
                  Only needed if automatic setup reports an error — e.g. the Sheets API
                  is not enabled or the Google permission is missing.
                </p>
              </div>
              <Badge tone={hasSpreadsheetId ? "live" : "phase"}>
                {hasSpreadsheetId ? "Connected" : "Not connected"}
              </Badge>
            </div>
            <ol className="mt-6 space-y-4 text-sm text-steel">
              <li className="flex gap-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-white">
                  1
                </span>
                <p>
                  <span className="font-semibold text-ink">Create the spreadsheet.</span>{" "}
                  In your Google Drive, create a spreadsheet named{" "}
                  <strong>Vaayu Checkpoints</strong> and rename its first tab to{" "}
                  <code className="bg-fog px-1.5 py-0.5 rounded font-mono text-xs">Checkpoints</code>.
                </p>
              </li>
              <li className="flex gap-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-white">
                  2
                </span>
                <div>
                  <p>
                    <span className="font-semibold text-ink">Set the header row.</span>{" "}
                    Row 1 must be exactly these 8 columns, in order:
                  </p>
                  <p className="mt-2 text-xs font-mono bg-fog p-3 rounded-lg border border-hairline-soft text-ink break-all">
                    id | note | user_id | user_email | user_role | created_at | updated_at | deleted_at
                  </p>
                </div>
              </li>
              <li className="flex gap-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-white">
                  3
                </span>
                <p>
                  <span className="font-semibold text-ink">Copy the spreadsheet ID.</span>{" "}
                  From the sheet&apos;s URL (<code className="bg-fog px-1.5 py-0.5 rounded font-mono text-xs">…/spreadsheets/d/&lt;ID&gt;/edit</code>),
                  copy the ID and set it as{" "}
                  <code className="bg-fog px-1.5 py-0.5 rounded font-mono text-xs">GOOGLE_SHEETS_CHECKPOINTS_ID</code>{" "}
                  in <code className="bg-fog px-1.5 py-0.5 rounded font-mono text-xs">.env.local</code> and in Vercel&apos;s environment variables.
                </p>
              </li>
              <li className="flex gap-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-white">
                  4
                </span>
                <p>
                  <span className="font-semibold text-ink">Re-authorize above.</span>{" "}
                  If your refresh token predates the Checkpoints feature, click{" "}
                  <strong>Re-authorize with Google</strong> so the token carries the Sheets permission. Deletes are soft-deletes (a{" "}
                  <code className="bg-fog px-1.5 py-0.5 rounded font-mono text-xs">deleted_at</code> stamp) — the app always hides deleted rows.
                </p>
              </li>
            </ol>
          </Reveal>
        </div>

        {/* Step-by-Step Guide */}
        <div className="mt-10">
          <Reveal delay={100} className="rounded-2xl border border-hairline bg-canvas p-6 sm:p-8">
            <h2 className="font-display text-xl font-bold tracking-tight">
              One-Time Setup Instructions
            </h2>
            <ol className="mt-6 space-y-6 text-sm text-steel">
              <li className="flex gap-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-white">
                  1
                </span>
                <div>
                  <p className="font-semibold text-ink">Create a Google Cloud Project</p>
                  <p className="mt-1">
                    Visit the{" "}
                    <a
                      href="https://console.cloud.google.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-ink underline hover:opacity-80"
                    >
                      Google Cloud Console
                    </a>
                    , create a new project (or select an existing one). Standard Drive API usage is 100% free with no billing needed.
                  </p>
                </div>
              </li>

              <li className="flex gap-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-white">
                  2
                </span>
                <div>
                  <p className="font-semibold text-ink">Enable the Google Drive API and the Google Sheets API</p>
                  <p className="mt-1">
                    Go to <strong>APIs &amp; Services → Library</strong>, search for <strong>Google Drive API</strong>, and click <strong>Enable</strong> — then do the same for <strong>Google Sheets API</strong> (the Checkpoints timeline needs it).
                  </p>
                </div>
              </li>

              <li className="flex gap-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-white">
                  3
                </span>
                <div>
                  <p className="font-semibold text-ink">Configure OAuth Consent Screen &amp; Set to Production</p>
                  <p className="mt-1">
                    Go to <strong>APIs &amp; Services → OAuth consent screen</strong>. Select <strong>External</strong>.
                  </p>
                  <p className="mt-2 text-xs font-mono bg-fog p-3 rounded-lg border border-hairline-soft text-ink">
                    <strong>Critical tip:</strong> Under Publishing status, click <strong>Publish App</strong> (In Production) so the refresh token won&apos;t expire after 7 days. You do NOT need Google verification for personal use.
                  </p>
                </div>
              </li>

              <li className="flex gap-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-white">
                  4
                </span>
                <div>
                  <p className="font-semibold text-ink">Create OAuth 2.0 Credentials</p>
                  <p className="mt-1">
                    Go to <strong>APIs &amp; Services → Credentials → Create Credentials → OAuth client ID</strong>.
                  </p>
                  <ul className="mt-2 list-disc list-inside space-y-1 text-xs">
                    <li>Application type: <strong>Web application</strong></li>
                    <li>
                      Authorized redirect URI:
                      <code className="ml-1 bg-fog px-2 py-0.5 rounded border border-hairline-soft font-mono">
                        &#123;YOUR_DOMAIN&#125;/api/drive/oauth/callback
                      </code>
                    </li>
                  </ul>
                </div>
              </li>

              <li className="flex gap-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-white">
                  5
                </span>
                <div>
                  <p className="font-semibold text-ink">Add Client ID &amp; Secret to Environment Variables</p>
                  <p className="mt-1">
                    Add <code className="bg-fog px-1.5 py-0.5 rounded font-mono text-xs">GOOGLE_CLIENT_ID</code> and{" "}
                    <code className="bg-fog px-1.5 py-0.5 rounded font-mono text-xs">GOOGLE_CLIENT_SECRET</code> to your Vercel project environment variables (and <code className="bg-fog px-1.5 py-0.5 rounded font-mono text-xs">.env.local</code> for local dev).
                  </p>
                </div>
              </li>

              <li className="flex gap-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-white">
                  6
                </span>
                <div>
                  <p className="font-semibold text-ink">Authorize and Save the Refresh Token</p>
                  <p className="mt-1">
                    Click the <strong>Authorize with Google</strong> button above. After approving consent, Google will redirect back and display your refresh token once. Copy it and set it as{" "}
                    <code className="bg-fog px-1.5 py-0.5 rounded font-mono text-xs">GOOGLE_DRIVE_REFRESH_TOKEN</code> in Vercel.
                  </p>
                </div>
              </li>
            </ol>
          </Reveal>
        </div>
      </section>
    </AppShell>
  );
}
