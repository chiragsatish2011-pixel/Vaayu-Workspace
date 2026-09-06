"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthError, AuthField, AuthSubmit } from "@/components/AuthLayout";
import { CheckIcon } from "@/components/icons";

/**
 * Change-password form, shared by /set-password (mandatory first login)
 * and /settings (voluntary change). On success the password API clears
 * `must_change_password`; mandatory users are silently re-signed in with
 * the new password so their JWT is fresh, then sent to the dashboard.
 */
export function PasswordForm({
  email,
  mandatory = false,
}: {
  email: string;
  mandatory?: boolean;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (next !== confirm) {
      setError("New passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        setError(data?.error ?? "Couldn't change the password.");
        return;
      }
      if (mandatory) {
        // Mint a fresh session (flag cleared) and enter the workspace.
        const login = await signIn("credentials", {
          email,
          password: next,
          redirect: false,
        });
        if (login?.error || !login?.ok) {
          router.push("/signin");
        } else {
          router.push("/");
          router.refresh();
        }
      } else {
        setCurrent("");
        setNext("");
        setConfirm("");
        setDone(true);
      }
    } catch {
      setError("Couldn't change the password. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <AuthField
        label={mandatory ? "Temporary password" : "Current password"}
        type="password"
        required
        autoComplete="current-password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        placeholder="••••••••"
      />
      <AuthField
        label="New password (min 8 characters)"
        type="password"
        required
        minLength={8}
        autoComplete="new-password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        placeholder="••••••••"
      />
      <AuthField
        label="Confirm new password"
        type="password"
        required
        minLength={8}
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="••••••••"
      />
      {error && <AuthError message={error} />}
      {done && (
        <p className="flex animate-fade-in items-center gap-2 rounded-lg border border-success-text/30 bg-success-bg px-3.5 py-2.5 text-sm text-success-text">
          <CheckIcon className="h-4 w-4 shrink-0" />
          Password changed.
        </p>
      )}
      <div className="pt-1">
        <AuthSubmit loading={loading}>
          {loading ? "Saving…" : mandatory ? "Set password & enter" : "Change password"}
        </AuthSubmit>
      </div>
    </form>
  );
}
