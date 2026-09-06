"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ProfileNameFormProps {
  initialName: string | null;
}

export function ProfileNameForm({ initialName }: ProfileNameFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initialName ?? "");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(
    null
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage({ text: data.error || "Failed to update display name.", error: true });
      } else {
        setMessage({ text: "Display name saved successfully." });
        router.refresh();
      }
    } catch {
      setMessage({ text: "An unexpected error occurred. Please try again.", error: true });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
      <div>
        <label
          htmlFor="display-name"
          className="block text-xs font-mono uppercase tracking-[0.18em] text-stone"
        >
          Your Name
        </label>
        <input
          id="display-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Enter your name"
          maxLength={100}
          className="mt-2 w-full max-w-md rounded-xl border border-hairline bg-canvas px-4 py-2.5 text-sm text-ink outline-none transition focus:border-ink"
        />
        <p className="mt-1 text-xs text-stone">
          Choose a display name for your account. Leave blank to clear.
        </p>
      </div>

      {message && (
        <p
          className={`text-xs ${
            message.error ? "text-error-text font-medium" : "text-success-text font-medium"
          }`}
        >
          {message.text}
        </p>
      )}

      <div>
        <button
          type="submit"
          disabled={loading}
          className="rounded-xl bg-ink px-4 py-2 text-xs font-medium text-white transition hover:bg-black/80 disabled:opacity-50"
        >
          {loading ? "Saving..." : "Save Name"}
        </button>
      </div>
    </form>
  );
}
