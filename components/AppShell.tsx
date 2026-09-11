import { Badge } from "@/components/Badge";
import { GlobalSearch } from "@/components/GlobalSearch";
import { MobileNav, NavLinks } from "@/components/MobileNav";
import { MobileSearch } from "@/components/MobileSearch";
import { OnboardingFlow } from "@/components/OnboardingFlow";
import { SignOutButton } from "@/components/SignOutButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserAvatar } from "@/components/UserAvatar";
import { getDisplayName } from "@/lib/userColor";
import { Wordmark } from "@/components/Wordmark";

export interface ShellUser {
  id?: string | null;
  email: string;
  role: "admin" | "member";
  displayName?: string | null;
  avatarDriveId?: string | null;
}

/**
 * Workspace shell — sticky sidebar (desktop) + topbar + mobile drawer.
 * Server component; interactivity lives in <MobileNav/> + <SignOutButton/>.
 */
export function AppShell({
  user,
  active,
  children,
  fullBleed,
}: {
  user: ShellUser;
  active?: string;
  children: React.ReactNode;
  /**
   * Full-bleed mode: the content fills the main column edge-to-edge with no
   * max-width, side padding, or bottom gap. Used by Chat, which IS a
   * full-page two-pane interface — not a card floating inside page chrome.
   */
  fullBleed?: boolean;
}) {
  const primary = getDisplayName(user.displayName, user.email);
  const secondary = user.email;
  return (
    <div className="flex min-h-screen bg-canvas text-ink">
      <OnboardingFlow
        initialDisplayName={user.displayName}
        initialRole={user.role}
        email={user.email}
      />
      {/* ── Sidebar (desktop) ── */}
      <aside className="sticky top-0 hidden h-screen w-[264px] shrink-0 flex-col border-r border-hairline-soft bg-canvas lg:flex">
        <div className="px-5 pb-2 pt-5">
          <Wordmark />
          <p className="mt-4 px-1 font-mono text-[11px] uppercase tracking-[0.22em] text-stone">
            Workspace
          </p>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-2">
          <NavLinks active={active} role={user.role} />
        </nav>
        <div className="border-t border-hairline-soft p-4">
          <div className="mb-3 flex items-center gap-3 rounded-xl bg-fog px-3 py-2.5">
            <UserAvatar displayName={user.displayName} email={user.email} userId={user.id ?? undefined} avatarDriveId={user.avatarDriveId} size={36} />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[13px] font-semibold">
                {primary}
              </span>
              <span className="block truncate font-mono text-[11px] text-steel">
                {secondary}
              </span>
              <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-steel">
                {user.role}
              </span>
            </span>
          </div>
          <SignOutButton />
        </div>
      </aside>

      {/* ── Main column ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-hairline-soft bg-canvas/85 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
            <MobileNav active={active} role={user.role} />
            <div className="lg:hidden">
              <Wordmark compact />
            </div>
            {/* Global search — chats, people, projects, files */}
            <div className="ml-auto hidden min-w-0 flex-1 max-w-xs sm:flex">
              <GlobalSearch />
            </div>
            <div className="ml-auto flex items-center gap-2 sm:ml-0">
              <MobileSearch />
              <ThemeToggle compact />
              <Badge tone="live">
                <span className="h-1.5 w-1.5 rounded-full bg-success-text" />
                Live
              </Badge>
              <span title={`${primary} · ${user.role}`}>
                <UserAvatar displayName={user.displayName} email={user.email} userId={user.id ?? undefined} avatarDriveId={user.avatarDriveId} size={36} />
              </span>
            </div>
          </div>
        </header>
        <div className={fullBleed ? "flex min-w-0 flex-1 flex-col" : "mx-auto w-full max-w-6xl flex-1 px-4 pb-16 sm:px-6"}>
          {children}
        </div>
        <footer className="border-t border-hairline-soft">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-5 font-mono text-[11px] uppercase tracking-[0.18em] text-stone sm:px-6">
            <span>Vaayu Workspace</span>
            <span className="ml-auto">© {new Date().getFullYear()}</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
