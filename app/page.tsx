import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Badge, LiveDot } from "@/components/Badge";
import { Greeting } from "@/components/Greeting";
import { Reveal } from "@/components/Reveal";
import { SectionMatrix, StatusTable } from "@/components/SectionMatrix";
import { ArrowRightIcon } from "@/components/icons";
import { requireActiveSession } from "@/lib/session";
import { getSetupStatus } from "@/lib/setup";
import { getDisplayName } from "@/lib/userColor";
import { db } from "@/db";
import { projects, users } from "@/db/schema";
import { getCheckpoints } from "@/lib/checkpoints-store";
import { count, desc } from "drizzle-orm";

import { SECTIONS } from "@/components/sections";

const marqueeItems = [
  "Files",
  "Projects",
  "Chat",
  "Phase 01 live",
  "Secure sessions",
  "Vercel + Neon",
];

// Setup state can change at any time (fresh install → configured), so this
// page must run per request — never serve a prerendered redirect.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // Fresh workspace (no DB / tables / users yet) → send the owner to setup.
  // Uses hasUsers (COUNT(*) > 0), not just admin, so setup stays locked even
  // if only members remain.
  const setup = await getSetupStatus();
  const setupDone = setup.hasUsers || setup.admin;
  if (!setup.reachable || !setup.tables || !setupDone) redirect("/setup");

  // Signed in (guards redirect to /signin when there is no session).
  const user = await requireActiveSession();

  // Real operational metrics — never fabricated. Each count is a live DB/Sheet query.
  const [projectRows, memberCount, checkpointRows] = await Promise.all([
    db
      .select({ id: projects.id, title: projects.title, createdAt: projects.createdAt })
      .from(projects)
      .orderBy(projects.createdAt)
      .limit(100)
      .then((rows) => rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()))
      .catch(() => [] as Array<{ id: string; title: string; createdAt: Date }>),
    db
      .select({ c: count() })
      .from(users)
      .then((r) => Number(r[0]?.c ?? 0))
      .catch(() => 0),
    getCheckpoints()
      .then((rows) => rows)
      .catch(() => [] as Awaited<ReturnType<typeof getCheckpoints>>),
  ]);
  const projectCount = projectRows.length;
  const checkpointCount = checkpointRows.length;
  const recentProjects = projectRows.slice(0, 3);
  const recentCheckpoints = checkpointRows.slice(0, 3);

  const stats = [
    { value: String(projectCount).padStart(2, "0"), label: "Projects published" },
    { value: String(memberCount).padStart(2, "0"), label: "Team members" },
    { value: String(checkpointCount).padStart(2, "0"), label: "Checkpoints logged" },
    { value: String(SECTIONS.length).padStart(2, "0"), label: "Sections live" },
  ];

  return (
    <AppShell
      user={{ id: user.id, email: user.email, role: user.role, displayName: user.displayName, avatarDriveId: user.avatarDriveId }}
      active="/"
    >
      {/* ── Hero ── */}
      <section className="relative overflow-hidden pt-10 sm:pt-14">
        <div
          aria-hidden
          className="dot-grid pointer-events-none absolute inset-0 opacity-50 [mask-image:radial-gradient(75%_70%_at_50%_0%,#000,transparent)]"
        />
        <div className="relative">
          <p className="animate-fade-up font-mono text-xs uppercase tracking-[0.24em] text-stone">
            Team workspace — Phase 01
          </p>
          <h1
            className="mt-4 max-w-3xl animate-fade-up font-display text-5xl font-bold leading-[1.02] tracking-[-0.03em] sm:text-7xl"
            style={{ animationDelay: "90ms" }}
          >
            <Greeting />, team.
          </h1>
          <p
            className="mt-5 max-w-xl animate-fade-up text-base leading-relaxed text-steel sm:text-lg"
            style={{ animationDelay: "180ms" }}
          >
            Signed in as{" "}
            <span className="font-semibold text-ink">
              {getDisplayName(user.displayName, user.email)}
            </span>{" "}
            <span className="font-mono text-sm text-steel">({user.email})</span> ·{" "}
            <Badge tone="live" className="align-middle">
              {user.role}
            </Badge>{" "}
            — here&apos;s what&apos;s live and what lands next.
          </p>
          <div
            className="mt-7 flex animate-fade-up flex-wrap items-center gap-3"
            style={{ animationDelay: "270ms" }}
          >
            <a
              href="#sections"
              className="press inline-flex h-12 items-center gap-2 rounded-full bg-ink px-7 text-sm font-semibold text-white transition-colors duration-200 hover:bg-charcoal"
            >
              Explore sections
              <ArrowRightIcon className="h-4 w-4" />
            </a>
            <a
              href="#roadmap"
              className="press inline-flex h-12 items-center rounded-full border border-ink px-7 text-sm font-semibold text-ink transition-colors duration-200 hover:bg-ink hover:text-white"
            >
              View roadmap
            </a>
          </div>

          {/* Stats strip */}
          <dl className="mt-10 grid animate-fade-up grid-cols-2 gap-px overflow-hidden rounded-2xl border border-hairline bg-hairline lg:grid-cols-4"
            style={{ animationDelay: "360ms" }}
          >
            {stats.map((s) => (
              <div key={s.label} className="bg-canvas px-6 py-5">
                <dt className="order-2 mt-1 block text-[13px] leading-snug text-steel">
                  {s.label}
                </dt>
                <dd className="order-1 font-display text-4xl font-bold tracking-tight">
                  {s.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── Marquee band ── */}
      <section aria-hidden className="marquee-mask -mx-4 mt-10 overflow-hidden bg-pine py-3.5 sm:-mx-6">
        <div className="flex w-max animate-marquee gap-0">
          {[0, 1].map((copy) => (
            <div key={copy} className="flex shrink-0 items-center" aria-hidden={copy === 1}>
              {marqueeItems.map((item) => (
                <span
                  key={`${copy}-${item}`}
                  className="flex items-center gap-6 pr-6 font-mono text-xs uppercase tracking-[0.24em] text-white/85"
                >
                  {item}
                  <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
                </span>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* ── Operational overview — real data, not mocks ── */}
      <section className="pt-10">
        <Reveal>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-hairline bg-canvas p-6">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg font-bold">Recent projects</h3>
                <Link href="/projects" className="text-xs font-semibold text-ink underline">View all →</Link>
              </div>
              {recentProjects.length === 0 ? (
                <p className="mt-4 rounded-xl bg-fog px-4 py-6 text-center text-sm text-steel">No projects yet — publish your first project to see it here.</p>
              ) : (
                <ul className="mt-4 space-y-2">
                  {recentProjects.map((p) => (
                    <li key={p.id} className="flex items-center justify-between rounded-xl border border-hairline-soft bg-fog/50 px-4 py-3">
                      <span className="truncate text-sm font-medium text-ink">{p.title}</span>
                      <span className="ml-3 shrink-0 font-mono text-xs text-stone">{new Date(p.createdAt).toLocaleDateString()}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4 flex gap-2">
                <Link href="/projects" className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-white hover:bg-charcoal">Publish project</Link>
                <Link href="/files" className="rounded-full border border-hairline px-4 py-2 text-xs font-semibold hover:border-ink">Browse files</Link>
              </div>
            </div>
            <div className="rounded-2xl border border-hairline bg-canvas p-6">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg font-bold">Recent checkpoints</h3>
                <Link href="/checkpoints" className="text-xs font-semibold text-ink underline">Open canvas →</Link>
              </div>
              {recentCheckpoints.length === 0 ? (
                <p className="mt-4 rounded-xl bg-fog px-4 py-6 text-center text-sm text-steel">No checkpoints yet — be the first to post a milestone.</p>
              ) : (
                <ul className="mt-4 space-y-2">
                  {recentCheckpoints.map((c) => (
                    <li key={c.id} className="rounded-xl border border-hairline-soft bg-fog/50 px-4 py-3">
                      <p className="truncate text-sm font-medium text-ink">{c.note.slice(0, 80)}</p>
                      <p className="mt-1 font-mono text-xs text-stone">{c.userEmail} · {new Date(c.createdAt).toLocaleDateString()}</p>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4 flex gap-2">
                <Link href="/checkpoints" className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-white hover:bg-charcoal">Open canvas</Link>
                <Link href="/chat" className="rounded-full border border-hairline px-4 py-2 text-xs font-semibold hover:border-ink">Open chat</Link>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ── Section matrix ── */}
      <section id="sections" className="scroll-mt-24 pt-12">
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.24em] text-stone">
                Workspace matrix
              </p>
              <h2 className="mt-2 font-display text-3xl font-bold tracking-[-0.02em] sm:text-4xl">
                Four sections. One home.
              </h2>
            </div>
            <p className="flex items-center gap-2 text-sm text-steel">
              <LiveDot /> Auth &amp; shell live now
            </p>
          </div>
        </Reveal>
        <div className="mt-6">
          <SectionMatrix />
        </div>
      </section>

      {/* ── Roadmap table ── */}
      <section id="roadmap" className="scroll-mt-24 pt-12">
        <Reveal>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-stone">
            Roadmap
          </p>
          <h2 className="mt-2 font-display text-3xl font-bold tracking-[-0.02em] sm:text-4xl">
            What lands, and when.
          </h2>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-steel">
            Every section is already wired into navigation, auth and layout —
            later phases slot straight in without restructuring.
          </p>
        </Reveal>
        <Reveal delay={120} className="mt-6">
          <StatusTable />
        </Reveal>
        <Reveal delay={180}>
          <p className="mt-6 text-sm text-steel">
            Building something meanwhile?{" "}
            <Link
              href="/projects"
              className="font-semibold text-ink underline decoration-2 underline-offset-4 transition-colors hover:text-azure-deep"
            >
              Peek at the Projects plan
            </Link>
          </p>
        </Reveal>
      </section>
    </AppShell>
  );
}
