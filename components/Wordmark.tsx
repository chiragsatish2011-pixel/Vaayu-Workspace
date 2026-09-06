import Image from "next/image";
import Link from "next/link";

/** Vaayu brand lockup — transparent logo mark + Space Grotesk wordmark. */
export function Wordmark({
  compact = false,
  size = "md",
}: {
  compact?: boolean;
  /** "md" (header/nav) or "lg" (hero moments like sign-in). */
  size?: "md" | "lg";
}) {
  // Intrinsic dimensions match the source PNG aspect (~1.124); the rendered
  // height is set by class below with w-auto. No rounded corners, ring,
  // background or shadow — the PNG already has a transparent background and
  // must float cleanly on any surface.
  const dims = size === "lg" ? { w: 224, h: 199 } : { w: 128, h: 114 };
  return (
    <Link href="/" className="group flex items-center gap-4">
      <Image
        src="/logo.png"
        alt="Vaayu Workspace logo"
        width={dims.w}
        height={dims.h}
        priority
        className={
          compact
            ? "h-10 w-auto shrink-0 transition-transform duration-200 group-hover:scale-105"
            : size === "lg"
              ? "h-28 w-auto shrink-0 transition-transform duration-200 group-hover:scale-105"
              : "h-16 w-auto shrink-0 transition-transform duration-200 group-hover:scale-105"
        }
      />
      {!compact && (
        <span className="leading-none">
          <span
            className={`block font-display font-bold tracking-tight ${
              size === "lg" ? "text-3xl" : "text-[22px]"
            }`}
          >
            Vaayu
          </span>
          <span
            className={`mt-1 block font-mono uppercase tracking-[0.22em] text-stone ${
              size === "lg" ? "text-xs" : "text-[11px]"
            }`}
          >
            Workspace
          </span>
        </span>
      )}
    </Link>
  );
}
