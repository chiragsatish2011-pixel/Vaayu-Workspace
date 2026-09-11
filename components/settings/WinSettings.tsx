"use client";

import { useEffect, useState, useRef } from "react";
import { UserAvatar } from "@/components/UserAvatar";
import { getDisplayName } from "@/lib/userColor";
import { UploadPreferenceToggle } from "@/components/UploadPreferenceToggle";
import { useTheme, applyWorkspaceAccent, type ThemeChoice } from "@/components/ThemeToggle";
import {
  BellIcon,
  InfoIcon,
  MonitorIcon,
  PaintIcon,
  ShieldIcon,
  UserIcon,
  GridIcon,
} from "@/components/icons";

type WinUser = {
  id: string;
  email: string;
  role: "admin" | "member";
  displayName?: string | null;
  avatarDriveId?: string | null;
  department?: string | null;
  jobTitle?: string | null;
};

type NavId = "home" | "system" | "appearance" | "accounts" | "security" | "notifications" | "about";

const NAV: Array<{ id: NavId; label: string; desc: string; icon: React.ComponentType<React.SVGProps<SVGSVGElement>> }> = [
  { id: "home", label: "Home", desc: "Overview", icon: GridIcon },
  { id: "system", label: "System", desc: "Uploads & storage", icon: MonitorIcon },
  { id: "appearance", label: "Appearance", desc: "Light & dark", icon: PaintIcon },
  { id: "accounts", label: "Accounts", desc: "Profile & avatar", icon: UserIcon },
  { id: "security", label: "Privacy & security", desc: "Password & role", icon: ShieldIcon },
  { id: "notifications", label: "Notifications", desc: "Calls paused", icon: BellIcon },
  { id: "about", label: "About", desc: "Workspace info", icon: InfoIcon },
];

export function WinSettings({ user }: { user: WinUser }) {
  const [active, setActive] = useState<NavId>("home");
  return (
    <div className="flex min-h-[calc(100dvh-118px)] flex-col bg-[#fbfbfb] dark:bg-[#09090b] md:flex-row">
      {/* Left - Windows sidebar */}
      <aside className="w-full shrink-0 border-b border-hairline-soft bg-[#f3f3f3] p-3 dark:bg-[#101014] md:w-[280px] md:border-b-0 md:border-r">
          {/* User header like image */}
          <div className="flex items-center gap-3 rounded-xl px-2 py-3">
            <UserAvatar displayName={user.displayName} email={user.email} userId={user.id} avatarDriveId={user.avatarDriveId} size={44} />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold text-ink">{getDisplayName(user.displayName, user.email)}</p>
              <p className="truncate font-mono text-xs text-steel">{user.email}</p>
              <p className="font-mono text-[11px] text-stone">Local Account · {user.role}</p>
            </div>
          </div>

          <nav className="mt-2 space-y-0.5">
            {NAV.map((n) => {
              const isActive = active === n.id;
              const Icon = n.icon;
              return (
                <button
                  key={n.id}
                  onClick={() => setActive(n.id)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                    isActive ? "border border-hairline-soft bg-white text-ink shadow-sm dark:bg-[#1b1b1f]" : "text-charcoal hover:bg-white/60 hover:text-ink dark:hover:bg-white/10"
                  }`}
                >
                  <span className={`grid h-7 w-7 place-items-center rounded-md ${isActive ? "bg-[#0078d4] text-white" : "border border-hairline-soft bg-white text-steel dark:bg-[#1b1b1f]"} `}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium leading-none">{n.label}</span>
                    <span className="hidden text-[11px] text-stone md:block">{n.desc}</span>
                  </span>
                </button>
              );
            })}
          </nav>
          <p className="mt-4 hidden px-2 font-mono text-[10px] uppercase tracking-wider text-stone md:block">Vaayu Workspace · Settings</p>
        </aside>

        {/* Right - main */}
        <div className="min-w-0 flex-1 bg-[#f9f9f9] p-4 dark:bg-[#0c0c0e] sm:p-8">
          <div className="mx-auto w-full max-w-4xl">
          {active === "home" && <HomePanel user={user} onNav={setActive} />}
          {active === "system" && <SystemPanel />}
          {active === "appearance" && <AppearancePanel />}
          {active === "accounts" && <AccountsPanel user={user} />}
          {active === "security" && <SecurityPanel user={user} />}
          {active === "notifications" && <NotificationsPanel />}
          {active === "about" && <AboutPanel user={user} />}
          </div>
        </div>
    </div>
  );
}

function HomePanel({ user, onNav }: { user: WinUser; onNav: (id: NavId) => void }) {
  return (
    <div className="space-y-4">
      <h2 className="font-display text-2xl font-bold tracking-tight">Home</h2>

      {/* Device header like DESKTOP-IKK3TOO */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-hairline bg-white p-4 shadow-sm dark:bg-[#131316]">
        <div className="h-14 w-20 overflow-hidden rounded-lg border border-hairline bg-ink grid place-items-center">
          <span className="font-display text-lg font-bold tracking-tight text-white">{getDisplayName(user.displayName, user.email).slice(0, 2).toUpperCase()}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-ink">{getDisplayName(user.displayName, user.email)}’s workspace</p>
          <p className="truncate font-mono text-xs text-steel">{user.email} · {user.role}{user.department ? ` · ${user.department}` : ""}</p>
          <button onClick={() => onNav("accounts")} className="text-xs font-semibold text-[#0078d4] hover:underline">
            Rename / Edit profile
          </button>
        </div>
        <div className="hidden shrink-0 items-center gap-4 sm:flex">
          <div className="flex items-center gap-2 text-xs">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#e6f0ff] text-[#0078d4]">◈</span>
            <span className="leading-tight">
              <span className="block font-semibold">Storage</span>
              <span className="text-stone">Connected</span>
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#e6f0ff] text-[#0078d4]">●</span>
            <span className="leading-tight">
              <span className="block font-semibold">Workspace</span>
              <span className="text-stone">Online</span>
            </span>
          </div>
        </div>
      </div>

      {/* Info banner like "You need to activate Windows..." */}
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/60 dark:bg-[#211a0d]">
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#0078d4] text-[11px] font-bold text-white">i</span>
        <p className="flex-1 text-sm leading-relaxed text-amber-900 dark:text-amber-100">
          Calls is paused workspace-wide — Daily.co needs a card on file. Open{" "}
          <button onClick={() => onNav("notifications")} className="whitespace-nowrap font-semibold underline">
            Notifications
          </button>{" "}
          or see{" "}
          <a href="/calls" className="whitespace-nowrap font-semibold underline">
            /calls
          </a>{" "}
          for details. Files, projects, and chat are not affected.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.7fr_0.9fr]">
        {/* Left main card */}
        <div className="rounded-xl border border-hairline bg-white p-5 shadow-sm dark:bg-[#131316]">
          <div className="flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded bg-[#f3f3f3] text-xs">▦</span>
            <p className="text-sm font-semibold">Your Vaayu account</p>
          </div>
          <p className="mt-1 text-lg font-bold">It’s all here with your profile</p>
          <p className="mt-1 text-sm text-steel">Update your name, avatar, and department — they show up on checkpoints and project cards.</p>
          <div className="mt-3 flex items-center gap-3">
            <UserAvatar displayName={user.displayName} email={user.email} userId={user.id} avatarDriveId={user.avatarDriveId} size={40} />
            <div>
              <p className="text-sm font-semibold">{getDisplayName(user.displayName, user.email)}</p>
              <p className="font-mono text-xs text-steel">{user.jobTitle || "Set your title"}</p>
            </div>
            <button onClick={() => onNav("accounts")} className="ml-auto rounded-full border border-hairline bg-canvas px-4 py-1.5 text-xs font-semibold hover:border-ink">
              Manage
            </button>
          </div>
        </div>

        {/* Right recommended like image */}
        <div className="rounded-xl border border-hairline bg-white shadow-sm dark:bg-[#131316]">
          <div className="border-b border-hairline-soft p-4">
            <p className="text-sm font-semibold">Recommended settings</p>
            <p className="text-xs text-stone">Recent and commonly used</p>
          </div>
          <button onClick={() => onNav("system")} className="flex w-full items-center gap-3 border-b border-hairline-soft px-4 py-3 text-left hover:bg-fog/50">
            <MonitorIcon className="h-4 w-4 text-steel" />
            <span className="text-sm">System — Uploads</span>
            <span className="ml-auto text-stone">›</span>
          </button>
          <button onClick={() => onNav("accounts")} className="flex w-full items-center gap-3 border-b border-hairline-soft px-4 py-3 text-left hover:bg-fog/50">
            <UserIcon className="h-4 w-4 text-steel" />
            <span className="text-sm">Accounts — Profile</span>
            <span className="ml-auto text-stone">›</span>
          </button>
          <button onClick={() => onNav("security")} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-fog/50">
            <ShieldIcon className="h-4 w-4 text-steel" />
            <span className="text-sm">Privacy & security — Password</span>
            <span className="ml-auto text-stone">›</span>
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-hairline bg-white p-4 shadow-sm dark:bg-[#131316]">
        <p className="text-sm font-semibold">Personalize your workspace</p>
        <p className="mt-1 text-xs text-steel">Pick an accent — it tints headers and primary buttons workspace-wide. Saved on this device.</p>
        <PersonalizeSwatches />
      </div>
    </div>
  );
}

function PersonalizeSwatches() {
  const colors = ["#0a0a0a", "#1456f0", "#ff5530", "#a855f7", "#10b981", "#f59e0b"] as const;
  const [selected, setSelected] = useState<string>(() => {
    if (typeof window === "undefined") return "#0a0a0a";
    try {
      return window.localStorage.getItem("vaayu:workspace:accent") || "#0a0a0a";
    } catch {
      return "#0a0a0a";
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem("vaayu:workspace:accent", selected);
      applyWorkspaceAccent(selected);
    } catch {}
  }, [selected]);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("vaayu:workspace:accent");
      applyWorkspaceAccent(saved || "#0a0a0a");
    } catch {}
  }, []);
  return (
    <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
      {colors.map((c) => {
        const isActive = selected === c;
        return (
          <button
            key={c}
            type="button"
            onClick={() => setSelected(c)}
            aria-label={`Set accent ${c}`}
            title={c}
            className={`group relative h-14 rounded-lg border-2 transition-all ${isActive ? "border-ink ring-2 ring-ink/20 scale-[1.02]" : "border-hairline hover:border-steel/40 hover:scale-[1.02]"}`}
            style={{ background: c }}
          >
            {isActive && (
              <span className="absolute inset-0 grid place-items-center">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-white text-black shadow">
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                </span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function SystemPanel() {
  return (
    <div className="space-y-4">
      <h2 className="font-display text-2xl font-bold">System</h2>
      <p className="text-sm text-steel">How the workspace behaves on this device.</p>
      <div className="rounded-xl border border-hairline bg-white p-5 shadow-sm dark:bg-[#131316]">
        <div className="flex items-center gap-3">
          <MonitorIcon className="h-5 w-5 text-steel" />
          <h3 className="font-semibold">Uploads</h3>
        </div>
        <p className="mt-1 text-sm text-steel">Choose whether publishing keeps a window open or runs in the background toast.</p>
        <div className="mt-4 border-t border-hairline-soft pt-4">
          <UploadPreferenceToggle />
        </div>
      </div>
      <div className="rounded-xl border border-hairline bg-white p-5 opacity-60 shadow-sm dark:bg-[#131316]">
        <h3 className="font-semibold">Storage</h3>
        <p className="mt-1 text-sm text-steel">Drive usage and quotas surface on the Files page. This panel is a shortcut — real controls live there.</p>
        <a href="/files" className="mt-3 inline-flex rounded-full border border-hairline px-4 py-1.5 text-xs font-semibold hover:border-ink">
          Open Files
        </a>
      </div>
    </div>
  );
}

function AppearancePanel() {
  const { choice, set, mounted } = useTheme();
  const options: Array<{ id: ThemeChoice; label: string; desc: string }> = [
    { id: "light", label: "Light", desc: "Bright canvas" },
    { id: "dark", label: "Dark", desc: "Dimmed canvas" },
    { id: "system", label: "System", desc: "Follows device" },
  ];
  return (
    <div className="space-y-4">
      <h2 className="font-display text-2xl font-bold">Appearance</h2>
      <p className="text-sm text-steel">Light or dark canvas across the whole workspace. Saved on this device.</p>
      <div className="rounded-xl border border-hairline bg-white p-5 shadow-sm dark:bg-[#131316]">
        <div className="flex items-center gap-3">
          <PaintIcon className="h-5 w-5 text-steel" />
          <h3 className="font-semibold">Theme</h3>
          {!mounted && <span className="font-mono text-xs text-stone">Loading…</span>}
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Color theme">
          {options.map((o) => {
            const selected = choice === o.id;
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => set(o.id)}
                className={`rounded-xl border px-4 py-3 text-left transition-all ${
                  selected
                    ? "border-ink ring-2 ring-ink/20 dark:border-white dark:ring-white/20"
                    : "border-hairline hover:border-steel/50"
                }`}
              >
                <span className="block text-sm font-semibold">{o.label}</span>
                <span className="mt-0.5 block text-xs text-steel">{o.desc}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 font-mono text-[11px] text-stone">
          System follows your OS setting and updates automatically. The header toggle switches between light and dark directly.
        </p>
      </div>
    </div>
  );
}

function AccountsPanel({ user }: { user: WinUser }) {
  const [displayName, setDisplayName] = useState(user.displayName || "");
  const [department, setDepartment] = useState(user.department || "");
  const [jobTitle, setJobTitle] = useState(user.jobTitle || "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [avatarId, setAvatarId] = useState<string | null>(user.avatarDriveId || null);
  const [uploading, setUploading] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function saveProfile() {
    const trimmed = displayName.trim();
    if (trimmed.length < 2 || trimmed.length > 40) {
      setMsg("Display name must be 2–40 characters.");
      return;
    }
    if (department && !["Design", "Engineering", "Marketing"].includes(department)) {
      setMsg("Department must be Design, Engineering, or Marketing.");
      return;
    }
    if (jobTitle && (jobTitle.trim().length < 2 || jobTitle.trim().length > 40)) {
      setMsg("Role/title must be 2–40 characters.");
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const payload: Record<string, string> = { displayName: trimmed };
      if (department) payload.department = department;
      if (jobTitle.trim()) payload.jobTitle = jobTitle.trim();
      const res = await fetch("/api/user/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Could not save.");
      setMsg("Saved — refresh to see it everywhere.");
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  async function onAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setAvatarMsg(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/user/avatar", { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Upload failed.");
      setAvatarId(data.avatarDriveId);
      setAvatarMsg("Avatar updated.");
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      setAvatarMsg(err instanceof Error ? err.message : "Failed to upload.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeAvatar() {
    setUploading(true);
    try {
      const res = await fetch("/api/user/avatar", { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Could not remove.");
      setAvatarId(null);
      setAvatarMsg("Avatar removed.");
      setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      setAvatarMsg(err instanceof Error ? err.message : "Failed to remove.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="font-display text-2xl font-bold">Accounts</h2>
      <p className="text-sm text-steel">Your profile across Vaayu — name, avatar, and team fields.</p>

      <div className="rounded-xl border border-hairline bg-white p-5 shadow-sm dark:bg-[#131316]">
        <div className="flex items-center gap-4">
          <UserAvatar displayName={displayName || user.displayName} email={user.email} avatarDriveId={avatarId} size={56} />
          <div>
            <p className="font-semibold">{getDisplayName(displayName || user.displayName, user.email)}</p>
            <p className="font-mono text-xs text-steel">{user.email} · {user.role}</p>
          </div>
        </div>
        <div className="mt-4">
          <p className="font-mono text-xs uppercase tracking-wider text-steel">Profile picture</p>
          <p className="mt-1 text-xs text-steel">Stored in your team’s Google Drive. Images only, max 5MB.</p>
          <div className="mt-3 flex items-center gap-3">
            <input ref={fileRef} type="file" accept="image/*" onChange={onAvatar} className="hidden" />
            <button onClick={() => fileRef.current?.click()} disabled={uploading} className="rounded-full border border-hairline bg-canvas px-4 py-2 text-xs font-semibold hover:border-ink disabled:opacity-50">
              {uploading ? "Uploading…" : avatarId ? "Change picture" : "Upload picture"}
            </button>
            {avatarId && (
              <button onClick={removeAvatar} disabled={uploading} className="rounded-full border border-hairline px-4 py-2 text-xs font-medium text-steel hover:border-ink hover:text-ink disabled:opacity-50">
                Remove
              </button>
            )}
          </div>
          {avatarMsg && <p className="mt-2 text-xs text-steel">{avatarMsg}</p>}
        </div>
      </div>

      <div className="rounded-xl border border-hairline bg-white p-5 shadow-sm dark:bg-[#131316]">
        <p className="font-semibold">Your info</p>
        <div className="mt-4 space-y-4">
          <div>
            <label className="font-mono text-xs uppercase tracking-wider text-steel">Display name</label>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Alex Rivera" maxLength={40} className="mt-2 w-full rounded-xl border border-hairline bg-canvas px-4 py-2.5 text-sm outline-none focus:border-ink" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="font-mono text-xs uppercase tracking-wider text-steel">Field / Department</label>
              <select value={department} onChange={(e) => setDepartment(e.target.value)} className="mt-2 w-full rounded-xl border border-hairline bg-canvas px-4 py-2.5 text-sm outline-none focus:border-ink">
                <option value="">Select field</option>
                <option value="Design">Design</option>
                <option value="Engineering">Engineering</option>
                <option value="Marketing">Marketing</option>
              </select>
            </div>
            <div>
              <label className="font-mono text-xs uppercase tracking-wider text-steel">Role / Title at Vaayu</label>
              <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="Product Designer" maxLength={40} className="mt-2 w-full rounded-xl border border-hairline bg-canvas px-4 py-2.5 text-sm outline-none focus:border-ink" />
            </div>
          </div>
          <p className="font-mono text-[11px] text-stone">Field and title are shown on checkpoints and project cards. Admin/member permission stays admin-controlled.</p>
          <div className="flex items-center gap-3">
            <button onClick={saveProfile} disabled={saving} className="rounded-full bg-ink px-5 py-2 text-xs font-semibold text-white hover:bg-charcoal disabled:opacity-50">
              {saving ? "Saving…" : "Save"}
            </button>
            {msg && <span className="text-xs text-steel">{msg}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function SecurityPanel({ user }: { user: WinUser }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setErr(null);
    if (newPassword !== confirmPassword) {
      setErr("New passwords do not match.");
      return;
    }
    if (newPassword.length < 8) {
      setErr("New password must be at least 8 characters.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/user/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword }) });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Could not change password.");
      setMsg("Password changed successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to change password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="font-display text-2xl font-bold">Privacy & security</h2>
      <p className="text-sm text-steel">Sign-in and access for your account.</p>

      <div className="rounded-xl border border-hairline bg-white p-5 shadow-sm dark:bg-[#131316]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-semibold">Password</p>
            <p className="mt-1 text-sm text-steel">Bcrypt-hashed via NextAuth Credentials. No email reset — verify current password to change.</p>
          </div>
          <ShieldIcon className="h-5 w-5 text-steel" />
        </div>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Current password" className="w-full rounded-xl border border-hairline bg-canvas px-4 py-2.5 text-sm outline-none focus:border-ink" />
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New password (min 8 chars)" className="w-full rounded-xl border border-hairline bg-canvas px-4 py-2.5 text-sm outline-none focus:border-ink" />
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm new password" className="w-full rounded-xl border border-hairline bg-canvas px-4 py-2.5 text-sm outline-none focus:border-ink" />
          {err && <p className="text-xs text-red-600">{err}</p>}
          {msg && <p className="text-xs text-green-700">{msg}</p>}
          <button type="submit" disabled={saving} className="rounded-full bg-ink px-5 py-2 text-xs font-semibold text-white hover:bg-charcoal disabled:opacity-50">
            {saving ? "Updating…" : "Update password"}
          </button>
        </form>
      </div>

      <div className="rounded-xl border border-hairline bg-white p-5 shadow-sm dark:bg-[#131316]">
        <p className="font-semibold">Permissions</p>
        <p className="mt-1 text-sm text-steel">
          Your workspace role is <span className="font-semibold text-ink">{user.role}</span>. Admins manage members and workspace settings; members can publish and comment. Your Vaayu field/title (“{user.department || "—"} · {user.jobTitle || "—"}”) is just profile info, not a permission.
        </p>
      </div>
    </div>
  );
}

function NotificationsPanel() {
  return (
    <div className="space-y-4">
      <h2 className="font-display text-2xl font-bold">Notifications</h2>
      <p className="text-sm text-steel">Alerts for calls and workspace activity.</p>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900/60 dark:bg-[#211a0d]">
        <div className="flex items-center gap-2">
          <BellIcon className="h-5 w-5 text-amber-700 dark:text-amber-400" />
          <p className="font-semibold text-amber-900 dark:text-amber-100">Calls paused</p>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-amber-900/80 dark:text-amber-100/80">
          Calls is disabled workspace-wide because Daily.co now blocks rooms until a payment method is on file. There’s nothing to configure here while Calls is paused. See{" "}
          <a href="/calls" className="font-semibold underline">
            /calls
          </a>{" "}
          for the simple explanation. Chat and file notifications aren’t affected.
        </p>
      </div>
      <div className="rounded-xl border border-hairline bg-white p-5 opacity-60 shadow-sm dark:bg-[#131316]">
        <p className="font-semibold">Browser permissions</p>
        <p className="mt-1 text-sm text-steel">When Calls returns, you’ll be able to allow browser notifications here to get alerts while the tab is in the background.</p>
      </div>
    </div>
  );
}

function AboutPanel({ user }: { user: WinUser }) {
  return (
    <div className="space-y-4">
      <h2 className="font-display text-2xl font-bold">About</h2>
      <div className="rounded-xl border border-hairline bg-white p-5 shadow-sm dark:bg-[#131316]">
        <p className="font-semibold">Vaayu Workspace</p>
        <p className="mt-1 font-mono text-xs text-steel">Private team workspace</p>
        <div className="mt-4 grid gap-3 text-sm">
          <div className="flex justify-between gap-3 border-b border-hairline-soft py-2">
            <span className="shrink-0 text-steel">Signed in as</span>
            <span className="min-w-0 truncate text-right font-mono text-ink" title={user.email}>{user.email}</span>
          </div>
          <div className="flex justify-between gap-3 py-2">
            <span className="shrink-0 text-steel">Role</span>
            <span className="min-w-0 truncate text-right font-semibold capitalize">{user.role}</span>
          </div>
        </div>
      </div>
      <p className="text-xs text-stone">
        Settings are per-user and per-device where noted. Upload preference is stored in your browser (localStorage). Profile and password are per-account and sync everywhere.
      </p>
    </div>
  );
}
