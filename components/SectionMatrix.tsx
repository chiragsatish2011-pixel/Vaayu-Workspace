import Link from "next/link";
import { Badge } from "@/components/Badge";
import { Reveal } from "@/components/Reveal";
import { ArrowRightIcon } from "@/components/icons";
import { SECTIONS } from "@/components/sections";

/** Vibrant identity cards (MiniMax product-matrix): one gradient per section. */
export function SectionMatrix() {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {SECTIONS.map((s, i) => (
        <Reveal key={s.href} delay={i * 90}>
          <Link
            href={s.href}
            className={`card-sheen lift group flex min-h-[290px] flex-col rounded-[32px] bg-gradient-to-br p-8 text-white ${s.gradient} grad-pan-animated`}
          >
            <div className="relative z-[2] flex items-start justify-between gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-full border border-white/25 bg-white/15 backdrop-blur-sm transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6">
                <s.icon className="h-6 w-6" />
              </span>
              <Badge
                tone={s.badge.tone}
                className="border border-white/25 backdrop-blur-sm"
              >
                {s.badge.text}
              </Badge>
            </div>
            <h3 className="relative z-[2] mt-auto pt-10 font-display text-3xl font-bold leading-[1.02] tracking-[-0.03em] sm:text-[44px]">
              {s.wordmark}
            </h3>
            <p className="relative z-[2] mt-2 text-[15px] font-medium text-white/85">
              {s.tagline}
            </p>
            <span className="relative z-[2] mt-4 inline-flex items-center gap-2 text-sm font-semibold text-white">
              <span className="border-b-2 border-white/40 pb-0.5 transition-colors duration-200 group-hover:border-white">
                Explore section
              </span>
              <ArrowRightIcon className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1.5" />
            </span>
          </Link>
        </Reveal>
      ))}
    </div>
  );
}

/** Rule-separated status table (MiniMax data-table + Cohere research rows). */
export function StatusTable() {
  return (
    <div className="overflow-hidden rounded-2xl border border-hairline bg-canvas">
      <div className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-hairline bg-fog px-5 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-steel sm:grid-cols-[1fr_180px_130px_40px]">
        <span>Section</span>
        <span className="hidden sm:block">Status</span>
        <span className="hidden sm:block">Status</span>
        <span className="hidden sm:block" />
      </div>
      {SECTIONS.map((s) => (
        <Link
          key={s.href}
          href={s.href}
          className="group grid grid-cols-[1fr_auto] items-center gap-3 border-b border-hairline-soft px-5 py-4 transition-colors duration-200 last:border-0 hover:bg-fog sm:grid-cols-[1fr_180px_130px_40px]"
        >
          <span className="flex min-w-0 items-center gap-3">
            <span
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white"
              style={{ background: s.accent }}
            >
              <s.icon className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-semibold">
                {s.label}
              </span>
              <span className="block truncate text-[13px] text-steel">
                {s.blurb}
              </span>
            </span>
          </span>
          <span className="hidden font-mono text-xs text-steel sm:block">
            {s.phase}
          </span>
          <span className="hidden sm:block">
            <Badge tone={s.badge.tone}>{s.badge.text}</Badge>
          </span>
          <span className="grid h-9 w-9 place-items-center justify-self-end rounded-full border border-hairline text-steel transition-all duration-200 group-hover:border-ink group-hover:bg-ink group-hover:text-white sm:justify-self-start">
            <ArrowRightIcon className="h-4 w-4" />
          </span>
        </Link>
      ))}
    </div>
  );
}
