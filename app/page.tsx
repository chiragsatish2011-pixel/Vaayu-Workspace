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

import { SECTIONS } from "@/components/sections";

const stats = [
  { value: "01", label: "Live phase — auth + shell" },
  { value: String(SECTIONS.length).padStart(2, "0"), label: "Sections reserved" },
  { value: "06", label: "Phases on the roadmap" },
  { value: "00", label: "Hardcoded secrets" },
];

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
