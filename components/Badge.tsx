const tones: Record<string, string> = {
  new: "bg-coral text-white",
  beta: "bg-azure-soft text-azure-deep",
  live: "bg-success-bg text-success-text",
  phase: "bg-ink text-white",
  mono: "bg-mist text-steel",
};

/** Pill badge (MiniMax badge system: NEW coral · BETA pale-blue · LIVE green). */
export function Badge({
  tone = "mono",
  children,
  className = "",
}: {
  tone?: keyof typeof tones | string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-mono text-[11px] font-medium uppercase tracking-[0.08em] ${
        tones[tone] ?? tones.mono
      }${className ? ` ${className}` : ""}`}
    >
      {children}
    </span>
  );
}

/** Pulsing live dot for status rows. */
export function LiveDot({ className = "" }: { className?: string }) {
  return (
    <span className={`relative flex h-2 w-2${className ? ` ${className}` : ""}`}>
      <span className="absolute inline-flex h-full w-full animate-pulse-dot rounded-full bg-success-text" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-success-text" />
    </span>
  );
}
