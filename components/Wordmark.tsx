import Image from "next/image";
import Link from "next/link";

/** Vaayu brand lockup — big logo mark + Space Grotesk wordmark. */
export function Wordmark({
  compact = false,
  size = "md",
}: {
  compact?: boolean;
  /** "md" (header/nav) or "lg" (hero moments like sign-in). */
  size?: "md" | "lg";
}) {
  const dims = size === "lg" ? { w: 176, h: 157 } : { w: 96, h: 85 };
  return (
    <Link href="/" className="group flex items-center gap-3">
      <Image
        src="/logo.png"
        alt="Vaayu Workspace logo"
        width={dims.w}
        height={dims.h}
        priority
        className={
          size === "lg"
            ? "h-20 w-auto shrink-0 rounded-3xl shadow-[0_16px_56px_rgba(168,85,247,0.55)] transition-transform duration-200 group-hover:scale-105"
            : "h-12 w-auto shrink-0 rounded-2xl shadow-[0_8px_28px_rgba(168,85,247,0.45)] transition-transform duration-200 group-hover:scale-105"
        }
      />
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
