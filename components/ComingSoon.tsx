import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/Badge";
import { Reveal } from "@/components/Reveal";
import { ArrowLeftIcon, CheckIcon } from "@/components/icons";
import { sectionByKey, type SectionKey } from "@/components/sections";
import { requireActiveSession } from "@/lib/session";

/**
 * Section placeholder — full AppShell + the section's own vibrant identity,
 * honest "planned" checklist and phase badge. No invented functionality.
 */
export async function ComingSoon({ section }: { section: SectionKey }) {
  const user = await requireActiveSession();
  const s = sectionByKey(section);

  return (
    <AppShell
      user={{ email: user.email, role: user.role }}
      active={s.href}
    >
      {/* Identity band */}
      <section className="relative -mx-4 overflow-hidden sm:-mx-6">
        <div
          aria-hidden
          className={`grad-pan-animated absolute inset-0 bg-gradient-to-br ${s.gradient}`}
        />
        <div aria-hidden className="dot-grid-light absolute inset-0 opacity-50" />
        <div
          aria-hidden
          className="absolute -right-20 -top-28 h-80 w-80 animate-float-slow rounded-full bg-white/20 blur-[100px]"
        />
        <div className="relative px-4 pb-12 pt-12 sm:px-6 sm:pt-16">
          <div className="animate-fade-up">
            <Badge tone={s.badge.tone} className="border border-white/25 backdrop-blur-sm">
              {s.badge.text} · Coming soon
            </Badge>
          </div>
          <h1
            className="mt-4 animate-fade-up font-display text-6xl font-bold leading-[0.95] tracking-[-0.04em] text-white sm:text-8xl"
            style={{ animationDelay: "100ms" }}
          >
            {s.wordmark}
          </h1>
          <p
            className="mt-4 max-w-lg animate-fade-up text-lg font-medium text-white/90"
            style={{ animationDelay: "200ms" }}
          >
            {s.tagline}
          </p>
          <p
            className="mt-2 max-w-lg animate-fade-up text-[15px] text-white/75"
            style={{ animationDelay: "280ms" }}
          >
            {s.blurb} The route, navigation and layout are reserved now, so the
            real thing slots straight in.
          </p>
        </div>
        {/* Scalloped edge into canvas */}
        <svg
          aria-hidden
          viewBox="0 0 1440 56"
          preserveAspectRatio="none"
          className="relative block h-10 w-full text-canvas sm:h-14"
        >
          <path d="M0 56h1440V28C1200 50 960 56 720 44 480 32 240 12 0 28v28Z" fill="currentColor" />
        </svg>
      </section>

      {/* Planned work */}
      <section className="pt-10">
        <Reveal>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-stone">
            {s.phase}
          </p>
          <h2 className="mt-2 font-display text-3xl font-bold tracking-[-0.02em]">
            What&apos;s planned.
          </h2>
        </Reveal>
        <ul className="mt-6 grid gap-4 md:grid-cols-3">
          {s.planned.map((item, i) => (
            <Reveal as="li" key={item} delay={i * 100}>
              <div className="lift h-full rounded-2xl border border-hairline bg-canvas p-6 hover:border-ink">
                <span
                  className="grid h-10 w-10 place-items-center rounded-full text-white"
                  style={{ background: s.accent }}
                >
                  <CheckIcon className="h-5 w-5" />
                </span>
                <p className="mt-4 text-[15px] font-medium leading-relaxed">
                  {item}
                </p>
                <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.18em] text-stone">
                  Step {String(i + 1).padStart(2, "0")} / 03
                </p>
              </div>
            </Reveal>
          ))}
        </ul>
        <Reveal delay={150}>
          <Link
            href="/"
            className="press mt-8 inline-flex h-12 items-center gap-2 rounded-full bg-ink px-7 text-sm font-semibold text-white transition-colors duration-200 hover:bg-charcoal"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Back to dashboard
          </Link>
        </Reveal>
      </section>
    </AppShell>
  );
}
