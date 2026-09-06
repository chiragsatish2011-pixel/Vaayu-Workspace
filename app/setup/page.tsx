"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  AuthError,
  AuthField,
  AuthSubmit,
} from "@/components/AuthLayout";
import { Wordmark } from "@/components/Wordmark";
import { CheckIcon } from "@/components/icons";

/**
 * ONE-TIME SETUP WIZARD — this is NOT a public sign-up path.
 * It exists only to bootstrap the FIRST account (admin) on a fresh database
 * with zero users. The API (/api/setup/owner) refuses once ANY user exists,
 * and this page redirects to /signin as soon as hasUsers/admin is true —
 * even if someone knows the /setup URL — so it can never hijack a live
 * workspace or become open registration.
 */

interface Status {
  configured: boolean;
  reachable: boolean;
  tables: boolean;
  admin: boolean;
  hasUsers?: boolean;
  inviteConfigured?: boolean;
  isProduction: boolean;
}

type Step = 1 | 2 | 3 | 4;

function isSetupDone(s: Status): boolean {
  // Prefer hasUsers (COUNT(*) > 0); fall back to admin for old responses.
  return (s.hasUsers ?? s.admin) === true || s.admin === true;
}

function stepFromStatus(s: Status): Step {
  if (!s.reachable) return 1;
  if (!s.tables) return 2;
  if (!isSetupDone(s)) return 3;
  return 4;
}

async function getStatus(): Promise<Status> {
  const res = await fetch("/api/setup/status", { cache: "no-store" });
  if (!res.ok) throw new Error("Couldn't check setup status.");
  return (await res.json()) as Status;
}

function errorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "error" in data) {
    const e = (data as { error?: unknown }).error;
    if (typeof e === "string" && e) return e;
  }
  return fallback;
}

const steps: { n: Step; label: string }[] = [
  { n: 1, label: "Database" },
  { n: 2, label: "Tables" },
  { n: 3, label: "Owner" },
];

export default function SetupPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dbUrl, setDbUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"db" | "migrate" | "owner" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const s = await getStatus();
      setStatus(s);
      setLoadError(null);
      return s;
    } catch {
      setLoadError("Couldn't reach the app. Is the dev server running?");
      return null;
    }
  }, []);

  useEffect(() => {
    // Defer past first paint so the static shell renders immediately.
    const raf = requestAnimationFrame(() => {
      void refresh();
    });
    return () => cancelAnimationFrame(raf);
  }, [refresh]);

  // Self-disable: once ANY user exists, this route is dead — bounce to
  // sign-in even if someone navigates here directly. (The API enforces the
  // same rule server-side, so this is UX + defense in depth.)
  // Small delay so a just-finished owner still sees the success screen.
  useEffect(() => {
    if (!status || !isSetupDone(status)) return;
    const t = setTimeout(() => router.replace("/signin"), 2500);
    return () => clearTimeout(t);
  }, [status, router]);

  /** Poll status until reachable (dev server restarts itself after saving). */
  async function waitForReachable(tries = 12): Promise<Status | null> {
    for (let i = 0; i < tries; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      const s = await refresh();
      if (s?.reachable) return s;
    }
    return null;
  }

  async function saveDatabase(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy("db");
    try {
      const res = await fetch("/api/setup/database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ databaseUrl: dbUrl.trim() }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        saved?: boolean;
      } | null;
      if (!res.ok || !data) {
        setError(errorMessage(data, "Couldn't save that URL."));
        return;
      }
      if (data.saved === false) {
        setNotice(
          "Connection works. Set DATABASE_URL in Vercel, redeploy, then press Check again."
        );
        return;
      }
      setNotice("Saved. Waiting for the app to pick it up…");
      const s = await waitForReachable();
      if (s) {
        setDbUrl("");
        setNotice(null);
      } else {
        setNotice(
          "Saved, but the app hasn't picked it up yet. Restart the dev server (Ctrl+C, then npm run dev) and press Check again."
        );
      }
    } catch {
      setError("Couldn't save that URL. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function createTables() {
    setError(null);
    setBusy("migrate");
    try {
      const res = await fetch("/api/setup/migrate", { method: "POST" });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        setError(errorMessage(data, "Couldn't create the tables."));
        return;
      }
      await refresh();
    } catch {
      setError("Couldn't create the tables. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function createOwner(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy("owner");
    try {
      const res = await fetch("/api/setup/owner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok || !data) {
        setError(errorMessage(data, "Couldn't create the owner account."));
        return;
      }
      setPassword("");
      await refresh();
    } catch {
      setError("Couldn't create the owner account. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const current: Step = status ? stepFromStatus(status) : 1;

  return (
    <main className="flex min-h-screen flex-col bg-canvas text-ink">
      <div className="flex min-h-9 items-center justify-center bg-ink px-4 py-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/85">
          First-run setup · about 3 minutes
        </p>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <div
          aria-hidden
          className="dot-grid pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(70%_50%_at_50%_0%,#000,transparent)]"
        />
        <div className="relative mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
          <div className="animate-fade-up">
            <Wordmark />
            <p className="mt-8 font-mono text-xs uppercase tracking-[0.22em] text-stone">
              Setup
            </p>
            <h1 className="mt-3 font-display text-4xl font-bold leading-[1.02] tracking-[-0.02em] sm:text-5xl">
              Let&apos;s get your workspace live.
            </h1>
            <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-steel">
              Everything happens right here — no terminal, no SQL editor.
              The only detour is grabbing one free database string.
            </p>
          </div>

          {/* Stepper */}
          <ol className="mt-8 flex animate-fade-up items-center gap-2" style={{ animationDelay: "120ms" }}>
            {steps.map((s, i) => {
              const done = current > s.n;
              const isActive = current === s.n;
              return (
                <li key={s.n} className="flex flex-1 items-center gap-2 last:flex-none">
                  <span
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[13px] font-bold transition-colors duration-300 ${
                      done
                        ? "bg-success-text text-white"
                        : isActive
                          ? "bg-ink text-white"
                          : "border border-hairline bg-canvas text-stone"
                    }`}
                  >
                    {done ? <CheckIcon className="h-4 w-4" /> : s.n}
                  </span>
                  <span
                    className={`hidden text-sm sm:block ${
                      isActive || done ? "font-semibold text-ink" : "text-stone"
                    }`}
                  >
                    {s.label}
                  </span>
                  {i < steps.length - 1 && (
                    <span
                      className={`mx-1 h-px flex-1 transition-colors duration-300 ${
                        done ? "bg-success-text" : "bg-hairline"
                      }`}
                    />
                  )}
                </li>
              );
            })}
          </ol>

          <div className="mt-6 animate-fade-up" style={{ animationDelay: "200ms" }}>
            {loadError && <AuthError message={loadError} />}
            {!status && !loadError && (
              <div className="rounded-2xl border border-hairline bg-canvas p-8 text-center text-sm text-steel">
                Checking where you left off…
              </div>
            )}

            {status && current === 1 && (
              <section className="rounded-2xl border border-hairline bg-canvas p-6 shadow-[0_12px_40px_-24px_rgba(0,0,0,0.25)] sm:p-8">
                <p className="font-mono text-xs uppercase tracking-[0.22em] text-stone">
                  Step 1 of 3
                </p>
                <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">
                  Connect your database
                </h2>
                {status.isProduction ? (
                  <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-charcoal">
                    <p>
                      On Vercel the database URL lives in the project&apos;s
                      environment, so paste it there — it takes a minute:
                    </p>
                    <ol className="list-decimal space-y-2 pl-5">
                      <li>
                        Grab a free Postgres at{" "}
                        <a
                          href="https://neon.tech"
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold underline decoration-2 underline-offset-4 hover:text-azure-deep"
                        >
                          neon.tech
                        </a>{" "}
                        → dashboard → Connect → pooled URL.
                      </li>
                      <li>
                        Vercel → your project → Settings → Environment
                        Variables → add <code className="rounded bg-mist px-1.5 py-0.5 font-mono text-[13px]">DATABASE_URL</code> → redeploy.
                      </li>
                    </ol>
                    <button
                      type="button"
                      onClick={() => void refresh()}
                      className="press inline-flex h-11 items-center rounded-full border border-ink px-6 text-sm font-semibold transition-colors duration-200 hover:bg-ink hover:text-white"
                    >
                      I&apos;ve set it — check again
                    </button>
                  </div>
                ) : (
                  <form onSubmit={saveDatabase} className="mt-5 flex flex-col gap-4">
                    <p className="text-[15px] leading-relaxed text-charcoal">
                      You need one free Postgres. Get it here, then paste the
                      string below — we test it before saving anything:
                    </p>
                    <a
                      href="https://neon.tech"
                      target="_blank"
                      rel="noreferrer"
                      className="press inline-flex h-11 items-center justify-center gap-2 rounded-full bg-ink text-sm font-semibold text-white transition-colors duration-200 hover:bg-charcoal"
                    >
                      Get a free database at neon.tech
                    </a>
                    <p className="font-mono text-xs leading-relaxed text-steel">
                      neon.tech → sign up → new project → Connect → copy the
                      pooled connection string (keep ?sslmode=require).
                    </p>
                    <AuthField
                      label="Pooled connection string"
                      type="password"
                      required
                      autoComplete="off"
                      spellCheck={false}
                      value={dbUrl}
                      onChange={(e) => setDbUrl(e.target.value)}
                      placeholder="postgresql://…?sslmode=require"
                    />
                    {error && <AuthError message={error} />}
                    {notice && (
                      <p className="animate-fade-in rounded-lg border border-azure-deep/30 bg-azure-soft px-3.5 py-2.5 text-sm text-azure-deep">
                        {notice}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-3">
                      <AuthSubmit loading={busy === "db"}>
                        {busy === "db" ? "Testing & saving…" : "Test & save"}
                      </AuthSubmit>
                    </div>
                  </form>
                )}
              </section>
            )}

            {status && current === 2 && (
              <section className="rounded-2xl border border-hairline bg-canvas p-6 shadow-[0_12px_40px_-24px_rgba(0,0,0,0.25)] sm:p-8">
                <p className="font-mono text-xs uppercase tracking-[0.22em] text-stone">
                  Step 2 of 3
                </p>
                <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">
                  Create the tables
                </h2>
                <p className="mt-3 text-[15px] leading-relaxed text-charcoal">
                  One click builds the <code className="rounded bg-mist px-1.5 py-0.5 font-mono text-[13px]">users</code> table
                  (id, email, password hash, role). Safe to re-run — it refuses
                  if tables already exist.
                </p>
                {error && (
                  <div className="mt-4">
                    <AuthError message={error} />
                  </div>
                )}
                <div className="mt-5">
                  <button
                    type="button"
                    onClick={() => void createTables()}
                    disabled={busy === "migrate"}
                    className="press flex h-12 w-full items-center justify-center gap-2 rounded-full bg-ink text-sm font-semibold text-white transition-colors duration-200 hover:bg-charcoal disabled:cursor-wait disabled:opacity-60"
                  >
                    {busy === "migrate" && (
                      <span
                        aria-hidden
                        className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
                      />
                    )}
                    {busy === "migrate" ? "Creating…" : "Create tables"}
                  </button>
                </div>
              </section>
            )}

            {status && current === 3 && (
              <section className="rounded-2xl border border-hairline bg-canvas p-6 shadow-[0_12px_40px_-24px_rgba(0,0,0,0.25)] sm:p-8">
                <p className="font-mono text-xs uppercase tracking-[0.22em] text-stone">
                  Step 3 of 3
                </p>
                <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">
                  Create your owner account
                </h2>
                <p className="mt-3 text-[15px] leading-relaxed text-charcoal">
                  This first account is automatically an <strong>admin</strong>.
                  Everyone who signs up later is a member.
                </p>
                <form onSubmit={createOwner} className="mt-5 flex flex-col gap-4">
                  <AuthField
                    label="Email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@team.com"
                  />
                  <AuthField
                    label="Password (min 8 characters)"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                  {error && <AuthError message={error} />}
                  <div className="pt-1">
                    <AuthSubmit loading={busy === "owner"}>
                      {busy === "owner" ? "Creating…" : "Create owner account"}
                    </AuthSubmit>
                  </div>
                </form>
              </section>
            )}

            {status && current === 4 && (
              <section className="rounded-2xl border border-hairline bg-canvas p-6 text-center shadow-[0_12px_40px_-24px_rgba(0,0,0,0.25)] sm:p-10">
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-success-bg text-success-text">
                  <CheckIcon className="h-7 w-7" />
                </span>
                <h2 className="mt-4 font-display text-3xl font-bold tracking-tight">
                  You&apos;re live.
                </h2>
                <p className="mx-auto mt-2 max-w-md text-[15px] text-steel">
                  Database connected, tables created, owner account ready.
                  Sign in, then create member accounts from the Admin page —
                  there is no public registration.
                </p>
                <p className="mx-auto mt-3 max-w-md font-mono text-[11px] uppercase tracking-[0.18em] text-stone">
                  Setup is now locked — redirecting to sign-in…
                </p>
                <Link
                  href="/signin"
                  className="press mt-8 inline-flex h-12 items-center rounded-full bg-ink px-8 text-sm font-semibold text-white transition-colors duration-200 hover:bg-charcoal"
                >
                  Go to sign in
                </Link>
              </section>
            )}
          </div>

          <p className="mt-8 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-stone">
            Vaayu Workspace · setup lives at /setup
          </p>
        </div>
      </div>
    </main>
  );
}
