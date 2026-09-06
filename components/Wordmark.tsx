import Link from "next/link";

/** Vaayu wordmark — gradient tile + Space Grotesk wordmark. */
export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="group flex items-center gap-2.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#1456f0] via-[#a855f7] to-[#ff5530] font-display text-lg font-bold text-white shadow-[0_4px_14px_rgba(20,86,240,0.35)] transition-transform duration-200 group-hover:scale-105 group-hover:rotate-3">
        V
      </span>
      {!compact && (
        <span className="leading-none">
          <span className="block font-display text-[17px] font-bold tracking-tight">
            Vaayu
          </span>
          <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-stone">
            Workspace
          </span>
        </span>
      )}
    </Link>
  );
}
