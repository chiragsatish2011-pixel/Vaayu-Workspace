"use client";

import { useState, useRef } from "react";
import { UserAvatar } from "@/components/UserAvatar";
import { getDisplayName } from "@/lib/userColor";

export function SettingsForm({
  initialDisplayName,
  initialEmail,
  initialAvatarDriveId,
  initialRole,
  initialDepartment,
  initialJobTitle,
}: {
  initialDisplayName?: string | null;
  initialEmail: string;
  initialAvatarDriveId?: string | null;
  initialRole: string;
  initialDepartment?: string | null;
  initialJobTitle?: string | null;
}) {
  const [displayName, setDisplayName] = useState(initialDisplayName || "");
  const [department, setDepartment] = useState(initialDepartment || "");
  const [jobTitle, setJobTitle] = useState(initialJobTitle || "");
  const [savingName, setSavingName] = useState(false);
  const [nameMsg, setNameMsg] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);

  const [avatarId, setAvatarId] = useState<string | null>(initialAvatarDriveId || null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleProfileSave() {
    const trimmed = displayName.trim();
    if (trimmed.length < 2 || trimmed.length > 40) {
      setNameMsg("Display name must be 2–40 characters.");
      return;
    }
    if (department && !["Design", "Engineering", "Marketing"].includes(department)) {
      setNameMsg("Department must be Design, Engineering, or Marketing.");
      return;
    }
    if (jobTitle && (jobTitle.trim().length < 2 || jobTitle.trim().length > 40)) {
      setNameMsg("Role/title must be 2–40 characters.");
      return;
    }
    setSavingName(true);
    setNameMsg(null);
    try {
      const payload: Record<string, string> = { displayName: trimmed };
      if (department) payload.department = department;
      if (jobTitle.trim()) payload.jobTitle = jobTitle.trim();
      const res = await fetch("/api/user/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Could not save.");
      setNameMsg("Saved — refresh to see it everywhere.");
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      setNameMsg(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSavingName(false);
    }
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    setPwError(null);
    if (newPassword !== confirmPassword) {
      setPwError("New passwords do not match.");
      return;
    }
    if (newPassword.length < 8) {
      setPwError("New password must be at least 8 characters.");
      return;
    }
    setSavingPw(true);
    try {
      const res = await fetch("/api/user/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Could not change password.");
      setPwMsg("Password changed successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPwError(err instanceof Error ? err.message : "Failed to change password.");
    } finally {
      setSavingPw(false);
    }
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
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
      setUploadingAvatar(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleAvatarRemove() {
    setUploadingAvatar(true);
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
      setUploadingAvatar(false);
    }
  }

  const primary = getDisplayName(displayName || initialDisplayName, initialEmail);
  const secondary = initialEmail;

  return (
    <div className="space-y-6">
      {/* Profile header with deterministic color avatar */}
      <div className="flex items-center gap-4">
        <UserAvatar displayName={displayName || initialDisplayName} email={initialEmail} avatarDriveId={avatarId} size={56} />
        <div className="leading-tight">
          <p className="text-lg font-semibold">{primary}</p>
          <p className="font-mono text-xs text-steel">{secondary}</p>
          <p className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.18em] text-steel">
            {initialRole}
            {(department || initialDepartment) && ` · ${department || initialDepartment}`}
            {(jobTitle || initialJobTitle) && ` · ${jobTitle || initialJobTitle}`}
          </p>
        </div>
      </div>

      {/* Avatar */}
      <div>
        <p className="font-mono text-xs uppercase tracking-wider text-steel">Profile picture</p>
        <p className="mt-1 text-xs text-steel">Stored in your team&apos;s Google Drive (reuses existing infra). Images only, max 5MB.</p>
        <div className="mt-3 flex items-center gap-3">
          <input ref={fileRef} type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploadingAvatar}
            className="rounded-full border border-hairline bg-canvas px-4 py-2 text-xs font-semibold hover:border-ink disabled:opacity-50"
          >
            {uploadingAvatar ? "Uploading…" : avatarId ? "Change picture" : "Upload picture"}
          </button>
          {avatarId && (
            <button
              type="button"
              onClick={handleAvatarRemove}
              disabled={uploadingAvatar}
              className="rounded-full border border-hairline px-4 py-2 text-xs font-medium text-steel hover:border-ink hover:text-ink disabled:opacity-50"
            >
              Remove
            </button>
          )}
        </div>
        {avatarMsg && <p className="mt-2 text-xs text-steel">{avatarMsg}</p>}
      </div>

      {/* Profile — display name + Vaayu field/role */}
      <div className="border-t border-hairline-soft pt-5 space-y-4">
        <div>
          <label className="font-mono text-xs uppercase tracking-wider text-steel">Display name</label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Alex Rivera"
            maxLength={40}
            className="mt-2 w-full rounded-xl border border-hairline bg-canvas px-4 py-2.5 text-sm outline-none focus:border-ink"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="font-mono text-xs uppercase tracking-wider text-steel">Field / Department</label>
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="mt-2 w-full rounded-xl border border-hairline bg-canvas px-4 py-2.5 text-sm outline-none focus:border-ink"
            >
              <option value="">Select field</option>
              <option value="Design">Design</option>
              <option value="Engineering">Engineering</option>
              <option value="Marketing">Marketing</option>
            </select>
          </div>
          <div>
            <label className="font-mono text-xs uppercase tracking-wider text-steel">Role / Title at Vaayu</label>
            <input
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="Product Designer"
              maxLength={40}
              className="mt-2 w-full rounded-xl border border-hairline bg-canvas px-4 py-2.5 text-sm outline-none focus:border-ink"
            />
          </div>
        </div>
        <p className="font-mono text-[11px] text-stone">Field and title are shown on your profile and help teammates find you. System permission (Admin/Member) stays admin-controlled separately.</p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleProfileSave}
            disabled={savingName}
            className="rounded-full bg-ink px-5 py-2 text-xs font-semibold text-white hover:bg-charcoal disabled:opacity-50"
          >
            {savingName ? "Saving…" : "Save profile"}
          </button>
          {nameMsg && <span className="text-xs text-steel">{nameMsg}</span>}
        </div>
      </div>

      {/* Password */}
      <form onSubmit={handlePasswordChange} className="border-t border-hairline-soft pt-5">
        <p className="font-mono text-xs uppercase tracking-wider text-steel">Change password</p>
        <p className="mt-1 text-xs text-steel">Uses the same bcrypt-hashed Credentials auth (NextAuth). No email reset flow — just verify current password.</p>
        <div className="mt-3 space-y-3">
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Current password"
            className="w-full rounded-xl border border-hairline bg-canvas px-4 py-2.5 text-sm outline-none focus:border-ink"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password (min 8 chars)"
            className="w-full rounded-xl border border-hairline bg-canvas px-4 py-2.5 text-sm outline-none focus:border-ink"
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
            className="w-full rounded-xl border border-hairline bg-canvas px-4 py-2.5 text-sm outline-none focus:border-ink"
          />
        </div>
        {pwError && <p className="mt-2 text-xs text-red-600">{pwError}</p>}
        {pwMsg && <p className="mt-2 text-xs text-green-700">{pwMsg}</p>}
        <button
          type="submit"
          disabled={savingPw}
          className="mt-3 rounded-full bg-ink px-5 py-2 text-xs font-semibold text-white hover:bg-charcoal disabled:opacity-50"
        >
          {savingPw ? "Updating…" : "Update password"}
        </button>
      </form>
    </div>
  );
}
