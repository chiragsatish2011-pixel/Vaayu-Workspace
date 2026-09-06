import Image from "next/image";
import Link from "next/link";

/** Vaayu brand lockup — logo image + Space Grotesk wordmark. */
export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="group flex items-center gap-2.5">
      <Image
        src="/logo.png"
        alt="Vaayu Workspace logo"
        width={36}
        height={36}
        priority
        className="h-9 w-9 shrink-0 rounded-xl transition-transform duration-200 group-hover:scale-105"
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
