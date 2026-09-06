"use client";

import { useState } from "react";
import { AuthError, AuthField } from "@/components/AuthLayout";
import { CheckIcon } from "@/components/icons";

const ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";

/** 16-char unambiguous password from a CSPRNG — generated in-browser only. */
function generatePassword(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/**
 * Admin "create account" form. The password lives ONLY in this
 * component's state: it is sent once over HTTPS for hashing, then shown
 * once in the copy box below. Never logged, never stored in plaintext.
 * Only admins set passwords — users have no self-service password UI.
 */
export function CreateAccountForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        email?: string;
      } | null;
      if (!res.ok || !data?.email) {
        setError(data?.error ?? "Couldn't create the account.");
        return;
      }
      // Show the temp password ONCE, from local state — the server never
      // returns it. Clearing the inputs keeps it out of the form.
      setCreated({ email: data.email, password });
      setEmail("");
      setPassword("");
      setCopied(false);
    } catch {
      setError("Couldn't create the account. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function copyPassword() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.password);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = created.password;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <AuthField
          label="Email"
          type="email"
          required
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@team.com"
        />
        <div>
          <AuthField
            label="Password (min 8 characters)"
            type="text"
            required
            minLength={8}
            autoComplete="off"
            spellCheck={false}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Generate one or type your own"
          />
          <button
            type="button"
            onClick={() => setPassword(generatePassword())}
            className="press mt-2 inline-flex h-10 items-center rounded-full border border-ink px-5 text-sm font-semibold transition-colors duration-200 hover:bg-ink hover:text-white"
          >
            Generate password
          </button>
        </div>
        {error && <AuthError message={error} />}
        <div>
          <button
            type="submit"
            disabled={loading}
            className="press flex h-12 w-full items-center justify-center gap-2 rounded-full bg-ink text-sm font-semibold text-white transition-colors duration-200 hover:bg-charcoal disabled:cursor-wait disabled:opacity-60"
          >
            {loading && (
              <span
                aria-hidden
                className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
              />
            )}
            {loading ? "Creating…" : "Create account"}
          </button>
        </div>
      </form>

      {created && (
        <div className="mt-6 animate-fade-in rounded-2xl bg-pine-deep p-6 text-white">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <CheckIcon className="h-5 w-5 text-teal" />
            Account created for {created.email}
          </p>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-white/60">
            Copy this now — it will not be shown again
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-white/10 px-4 py-3 font-mono text-lg tracking-wide">
              {created.password}
            </code>
            <button
              type="button"
              onClick={copyPassword}
              className="press h-12 shrink-0 rounded-full bg-white px-5 text-sm font-semibold text-ink transition-opacity hover:opacity-90"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-3 text-[13px] text-white/60">
            Share it with them privately — only admins can set or change
            passwords.
          </p>
          <button
            type="button"
            onClick={() => setCreated(null)}
            className="mt-2 text-[13px] font-semibold text-white/80 underline underline-offset-4 hover:text-white"
          >
            Dismiss (the password is gone for good)
          </button>
        </div>
      )}
    </div>
  );
}
