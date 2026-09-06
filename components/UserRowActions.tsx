"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthError } from "@/components/AuthLayout";

/**
 * Per-user admin controls: change password + delete account.
 *
 * Rendered inside the admin team list (server component). Passwords typed
 * here are sent once over HTTPS for bcrypt hashing — never logged, never
 * stored in plaintext. No "current password" is asked: this is the admin
 * acting on someone else's account, not a self-service change.
 */
export function UserRowActions({
  id,
  email,
  isSelf,
}: {
  id: string;
  email: string;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<"password" | "delete" | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setExpanded(null);
    setNewPassword("");
    setError(null);
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, newPassword }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        setError(data?.error ?? "Couldn't change the password.");
        return;
      }
      // Clear the plaintext from the field immediately — it lives only in
      // this component's state and is never stored.
      setNewPassword("");
      setExpanded(null);
      setNotice("Password updated.");
    } catch {
      setError("Couldn't change the password. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        setError(data?.error ?? "Couldn't delete the account.");
        return;
      }
      setExpanded(null);
      router.refresh();
    } catch {
      setError("Couldn't delete the account. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex shrink-0 flex-col items-end gap-2">
      <span className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={() => {
            setNotice(null);
            setExpanded(expanded === "password" ? null : "password");
          }}
          className="press rounded-full border border-hairline px-3.5 py-1.5 text-xs font-semibold text-charcoal transition-colors duration-200 hover:border-ink hover:text-ink"
        >
          Change password
        </button>
        {!isSelf && (
          <button
            type="button"
            onClick={() => {
              setNotice(null);
              setExpanded(expanded === "delete" ? null : "delete");
            }}
            className="press rounded-full border border-error/40 px-3.5 py-1.5 text-xs font-semibold text-error transition-colors duration-200 hover:bg-error hover:text-white"
          >
            Delete
          </button>
        )}
      </span>

      {notice && (
        <span className="text-xs font-medium text-success-text">{notice}</span>
      )}

      {expanded === "password" && (
        <form
          onSubmit={savePassword}
          className="flex w-56 flex-col gap-2 rounded-xl border border-hairline bg-fog p-3"
        >
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-charcoal">
              New password for {email} (min 8)
            </span>
            <input
              type="text"
              required
              minLength={8}
              autoComplete="off"
              spellCheck={false}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Type the new password"
              className="h-9 rounded-lg border border-hairline bg-canvas px-2.5 text-[13px] text-ink outline-none placeholder:text-stone focus:border-azure-deep"
            />
          </label>
          {error && <AuthError message={error} />}
          <span className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="press flex-1 rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-charcoal disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={reset}
              className="press rounded-full border border-hairline px-3 py-1.5 text-xs font-semibold text-steel"
            >
              Cancel
            </button>
          </span>
        </form>
      )}

      {expanded === "delete" && !isSelf && (
        <span className="flex w-56 flex-col gap-2 rounded-xl border border-error/40 bg-error-bg p-3 text-xs">
          <span className="leading-snug text-charcoal">
            Delete <strong>{email}</strong>? They will lose access
            immediately. This can&apos;t be undone.
          </span>
          {error && <AuthError message={error} />}
          <span className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void confirmDelete()}
              className="press flex-1 rounded-full bg-error px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? "Deleting…" : "Confirm delete"}
            </button>
            <button
              type="button"
              onClick={reset}
              className="press rounded-full border border-hairline bg-canvas px-3 py-1.5 text-xs font-semibold text-steel"
            >
              Cancel
            </button>
          </span>
        </span>
      )}
    </span>
  );
}
