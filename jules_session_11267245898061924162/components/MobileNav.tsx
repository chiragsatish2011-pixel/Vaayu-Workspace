"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SECTIONS } from "@/components/sections";
import { SignOutButton } from "@/components/SignOutButton";
import { Wordmark } from "@/components/Wordmark";
import { CloseIcon, GearIcon, GridIcon, MenuIcon, ShieldIcon } from "@/components/icons";
import { useWorkspaceUnread } from "@/components/WorkspaceUnreadProvider";
import { ThemeToggle } from "@/components/ThemeToggle";

/** Mobile slide-over nav (drawer under 1024px, per the collapsing strategy). */
export function MobileNav({ active, role }: { active?: string; role?: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open ]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        className="press grid h-10 w-10 place-items-center rounded-full border border-hairline bg-canvas text-ink lg:hidden"
      >
        <MenuIcon className="h-5 w-5" />
      </button>

      <div
        aria-hidden={!open}
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-40 bg-ink/40 backdrop-blur-[2px] transition-opacity duration-300 lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[300px] flex-col bg-canvas shadow-2xl transition-transform duration-300 ease-out lg:hidden ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        role="dialog"
        aria-label="Workspace navigation"
      >
        <div className="flex items-center justify-between border-b border-hairline-soft px-5 py-4">
          <Wordmark />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
            className="press grid h-10 w-10 place-items-center rounded-full border border-hairline text-ink"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <NavLinks active={active} role={role} onNavigate={() => setOpen(false)} />
        </nav>
        <div className="flex items-center justify-between border-t border-hairline-soft p-4">
          <SignOutButton />
          <ThemeToggle variant="pill" />
        </div>
      </aside>
    </>
  );
}

export function NavLinks({
  active,
  role,
  onNavigate,
}: {
  active?: string;
  role?: string;
  onNavigate?: () => void;
}) {
  const { unread, markSeen } = useWorkspaceUnread();
  const unreadFor = (href: string): { has: boolean; count?: number } | null => {
    if (href === "/chat") return unread.chat.has ? unread.chat : null;
    if (href === "/checkpoints") return unread.checkpoints.has ? unread.checkpoints : null;
    if (href === "/projects") return unread.projects.has ? unread.projects : null;
    if (href === "/files") return unread.files.has ? unread.files : null;
    return null;
  };
  const items = [
    {
      href: "/",
      label: "Dashboard",
      icon: <GridIcon className="h-[18px] w-[18px]" />,
      dot: "#0a0a0a",
    },
    ...SECTIONS.map((s) => ({
      href: s.href,
      label: s.label,
      icon: <s.icon className="h-[18px] w-[18px]" />,
      dot: s.accent,
    })),
    {
      href: "/settings",
      label: "Settings",
      icon: <GearIcon className="h-[18px] w-[18px]" />,
      dot: "#5f5f5f",
    },
    ...(role === "admin"
      ? [
          {
            href: "/admin",
            label: "Admin",
            icon: <ShieldIcon className="h-[18px] w-[18px]" />,
            dot: "#d63a17",
          },
        ]
      : []),
  ];
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => {
        const isActive = active === item.href;
        const badge = unreadFor(item.href);
        const showDot = !!badge?.has;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={() => {
                onNavigate?.();
                if (item.href === "/chat") markSeen("chat");
                else if (item.href === "/checkpoints") markSeen("checkpoints");
                else if (item.href === "/projects") markSeen("projects");
                else if (item.href === "/files") markSeen("files");
              }}
              className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors duration-200 ${
                isActive
                  ? "bg-fog font-medium text-ink"
                  : showDot
                    ? "bg-amber-50 font-medium text-ink hover:bg-amber-100"
                    : "text-charcoal hover:bg-fog"
              } ${showDot && !isActive ? "ring-1 ring-amber-200" : ""}`}
            >
              <span className="relative grid place-items-center text-steel transition-colors duration-200 group-hover:text-ink">
                {item.icon}
                {showDot && (
                  <span className="absolute -right-1 -top-1 grid h-2.5 w-2.5 place-items-center rounded-full bg-amber-500 ring-2 ring-white">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                  </span>
                )}
              </span>
              <span className="flex-1">{item.label}</span>
              {showDot && badge?.count !== undefined && badge.count > 0 && (
                <span className="grid min-w-5 place-items-center rounded-full bg-amber-500 px-1.5 py-0.5 font-mono text-[11px] font-bold text-white">{badge.count > 99 ? "99+" : badge.count}</span>
              )}
              {showDot && !badge?.count && <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" aria-label="New" />}
              {isActive && <span className="h-4 w-1 rounded-full bg-ink" aria-hidden />}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
