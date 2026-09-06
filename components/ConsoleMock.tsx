const lines = [
  { prompt: "$", cmd: "vaayu status", delay: "0s" },
  { prompt: "›", cmd: "auth ............ online", delay: "0.4s" },
  { prompt: "›", cmd: "database ......... connected", delay: "0.9s" },
  { prompt: "›", cmd: "sessions ......... jwt · secure", delay: "1.4s" },
];

/**
 * Dark console mock (Cohere agent-console-card): status chips, typed lines,
 * shimmer bars and a blinking prompt. Pure CSS animation, no JS.
 */
export function ConsoleMock() {
  return (
    <div className="w-full overflow-hidden rounded-2xl border border-white/10 bg-ink text-white shadow-[0_24px_80px_-24px_rgba(0,0,0,0.7)]">
      <div className="flex items-center gap-2 border-b border-white/10 px-5 py-3.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-3 font-mono text-xs text-white/50">
          vaayu — team console
        </span>
        <span className="ml-auto hidden items-center gap-1.5 rounded-full bg-success-bg px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-success-text sm:inline-flex">
          <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-success-text" />
          Online
        </span>
      </div>
      <div className="space-y-3 px-5 py-5 font-mono text-[13px] leading-relaxed">
        {lines.map((l) => (
          <p
            key={l.cmd}
            className="animate-fade-in"
            style={{ animationDelay: l.delay }}
          >
            <span className="mr-2 text-white/40">{l.prompt}</span>
            <span className="text-white/90">{l.cmd}</span>
          </p>
        ))}
        <div className="space-y-2 pt-1" aria-hidden>
          <div className="shimmer-bar h-2 w-11/12 rounded-full" />
          <div
            className="shimmer-bar h-2 w-3/4 rounded-full"
            style={{ animationDelay: "0.3s" }}
          />
          <div
            className="shimmer-bar h-2 w-4/5 rounded-full"
            style={{ animationDelay: "0.6s" }}
          />
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          {["files", "projects", "chat", "calls"].map((t, i) => (
            <span
              key={t}
              className="animate-fade-in rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] text-white/70"
              style={{ animationDelay: `${1.6 + i * 0.25}s` }}
            >
              {t} · soon
            </span>
          ))}
        </div>
        <p className="console-caret pt-1 text-white/80">
          <span className="mr-2 text-white/40">$</span>vaayu invite teammate
        </p>
      </div>
    </div>
  );
}
