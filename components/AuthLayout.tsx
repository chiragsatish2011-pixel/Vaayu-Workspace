import Image from "next/image";
import { ConsoleMock } from "@/components/ConsoleMock";
import { Wordmark } from "@/components/Wordmark";

/**
 * Split-screen auth layout — white form canvas + deep-pine brand panel
 * (Cohere dark-feature-band). Topped by the black announcement bar.
 */
export function AuthLayout({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen flex-col bg-canvas text-ink">
      {/* Announcement bar */}
      <div className="flex min-h-9 items-center justify-center gap-2 bg-ink px-4 py-2 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/85">
          Secure sign-in to your workspace
        </p>
      </div>

      <div className="grid flex-1 lg:grid-cols-[1fr_1.05fr]">
        {/* Form side */}
        <div className="relative flex items-center justify-center overflow-hidden px-4 py-12 sm:px-8">
          <div
            aria-hidden
            className="dot-grid pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(70%_60%_at_50%_40%,#000,transparent)]"
          />
          <div className="relative w-full max-w-md animate-fade-up">
            <Wordmark size="lg" />
            <p className="mt-8 font-mono text-xs uppercase tracking-[0.22em] text-stone">
              {eyebrow}
            </p>
            <h1 className="mt-3 font-display text-4xl font-bold leading-[1.05] tracking-[-0.02em] sm:text-5xl">
              {title}
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-steel">
              {subtitle}
            </p>
            <div className="mt-8">{children}</div>
            <div className="mt-6 text-center text-sm text-steel">{footer}</div>
          </div>
        </div>

        {/* Brand panel side */}
        <div className="relative hidden overflow-hidden bg-pine-deep lg:block">
          {/* Fallback gradient (visible if the hero image fails to load) */}
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-br from-pine via-pine-deep to-navy"
          />
          {/* Hero background image — optimized via next/image (cover, centered) */}
          <Image
            src="/backgrounds/vaayu-hero-bg.jpg"
            alt=""
            fill
            priority
            sizes="(max-width: 1024px) 0vw, 55vw"
            className="object-cover object-center"
          />
          {/* Dark overlay (35%) for text contrast over bright streaks */}
          <div aria-hidden className="absolute inset-0 bg-slate-950/35" />
          <div
            aria-hidden
            className="dot-grid-light absolute inset-0 opacity-60"
          />
          <div
            aria-hidden
            className="absolute -left-24 -top-24 h-96 w-96 animate-float-slow rounded-full bg-teal/25 blur-[110px]"
          />
          <div
            aria-hidden
            className="absolute -bottom-32 -right-24 h-[28rem] w-[28rem] animate-float-slower rounded-full bg-azure/30 blur-[130px]"
          />
          <div className="relative flex h-full flex-col justify-center px-12 py-16 xl:px-20">
            <p
              className="animate-fade-up font-mono text-xs uppercase tracking-[0.24em] text-white/60"
              style={{ animationDelay: "100ms" }}
            >
              Vaayu Workspace
            </p>
            <h2
              className="mt-4 max-w-md animate-fade-up font-display text-5xl font-bold leading-[1.02] tracking-[-0.03em] text-white xl:text-6xl"
              style={{ animationDelay: "200ms" }}
            >
              One workspace.
              <br />
              Zero chaos.
            </h2>
            <p
              className="mt-5 max-w-md animate-fade-up text-[15px] leading-relaxed text-white/70"
              style={{ animationDelay: "300ms" }}
            >
              Files, project packages, chat and calls for your 3–10 person
              team — starting with secure sign-in today.
            </p>
            <div
              className="mt-10 max-w-md animate-fade-up"
              style={{ animationDelay: "450ms" }}
            >
              <ConsoleMock />
            </div>
            <div className="mt-auto flex items-center gap-5 pt-12 font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">
              <span>Secure sessions</span>
              <span aria-hidden>·</span>
              <span>Private workspace</span>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

/** Shared auth form primitives (MiniMax text-input + black pill CTA). */
export function AuthField({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-charcoal">{label}</span>
      <input
        {...props}
        className="h-11 rounded-lg border border-hairline bg-canvas px-3.5 text-[15px] text-ink outline-none transition-all duration-200 placeholder:text-stone hover:border-stone focus:border-azure-deep focus:ring-2 focus:ring-azure-deep/25"
      />
    </label>
  );
}

export function AuthSubmit({
  loading,
  children,
}: {
  loading: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="press flex h-12 w-full items-center justify-center gap-2 rounded-full bg-ink text-sm font-semibold text-white transition-colors duration-200 hover:bg-charcoal disabled:cursor-wait disabled:opacity-60"
    >
      {loading && (
        <span
          aria-hidden
          className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
        />
      )}
      {children}
    </button>
  );
}

export function AuthError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="animate-fade-in rounded-lg border border-error/30 bg-error-bg px-3.5 py-2.5 text-sm text-error"
    >
      {message}
    </p>
  );
}
