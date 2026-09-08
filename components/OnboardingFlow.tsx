"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Step = 1 | 2 | 3;

export function OnboardingFlow({
  initialDisplayName,
  initialRole,
  email,
}: {
  initialDisplayName?: string | null;
  initialRole: "admin" | "member";
  email: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [displayName, setDisplayName] = useState(initialDisplayName || email.split("@")[0] || "");
  const [department, setDepartment] = useState<string>("");
  const [jobTitle, setJobTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check if onboarding needed - fetch from API (hasCompletedOnboarding is in JWT but may be stale on first login)
    fetch("/api/user/onboarding", { cache: "no-store" })
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (r.ok && data && !data.hasCompletedOnboarding) {
          setOpen(true);
        }
      })
      .catch(() => {});
  }, []);

  if (!open) return null;

  const totalSteps = 3;
  const canNext1 = displayName.trim().length >= 2 && displayName.trim().length <= 40;
  const canNext2 = department !== "";
  const canFinish = canNext1 && canNext2 && jobTitle.trim().length >= 2 && jobTitle.trim().length <= 40;

  async function handleFinish() {
    if (!canFinish) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/user/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: displayName.trim(),
          department,
          jobTitle: jobTitle.trim(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Could not save.");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl border border-hairline bg-canvas p-6 sm:p-8 shadow-2xl">
        {/* Progress */}
        <div className="flex items-center gap-2">
          {[1, 2, 3].map((s) => (
            <div key={s} className={`h-1.5 flex-1 rounded-full transition-colors ${s <= step ? "bg-ink" : "bg-hairline-soft"}`} />
          ))}
          <span className="ml-2 font-mono text-xs text-steel">
            {step}/{totalSteps}
          </span>
        </div>

        {step === 1 && (
          <div className="mt-6">
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-stone">Welcome to Vaayu</p>
            <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">How should we call you?</h2>
            <p className="mt-2 text-sm text-steel">This is the name your teammates will see in checkpoints, chat, and projects.</p>
            <input
              autoFocus
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Alex Rivera"
              maxLength={40}
              className="mt-5 w-full rounded-2xl border border-hairline bg-canvas px-4 py-3 text-sm outline-none focus:border-ink"
            />
            <p className="mt-2 font-mono text-[11px] text-stone">{email}</p>
            {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
            <div className="mt-6 flex justify-end">
              <button
                disabled={!canNext1}
                onClick={() => setStep(2)}
                className="rounded-full bg-ink px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="mt-6">
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-stone">Step 2 · Your field</p>
            <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">What field are you in?</h2>
            <p className="mt-2 text-sm text-steel">Where do you do your best work at Vaayu? This helps teammates find you.</p>
            <div className="mt-5 grid gap-2">
              {[
                { id: "Design", desc: "Product, visual, brand — crafting how Vaayu looks and feels." },
                { id: "Engineering", desc: "Frontend, backend, full-stack — building the product." },
                { id: "Marketing", desc: "Growth, content, comms — sharing Vaayu with the world." },
              ].map((d) => (
                <button
                  key={d.id}
                  onClick={() => setDepartment(d.id)}
                  className={`rounded-xl border p-4 text-left transition-colors ${department === d.id ? "border-ink bg-fog" : "border-hairline hover:border-stone"}`}
                >
                  <p className="text-sm font-semibold">{d.id}</p>
                  <p className="mt-1 text-xs text-steel">{d.desc}</p>
                </button>
              ))}
            </div>
            <div className="mt-6 flex justify-between">
              <button onClick={() => setStep(1)} className="rounded-full border border-hairline px-6 py-2.5 text-sm font-medium">
                Back
              </button>
              <button disabled={!canNext2} onClick={() => setStep(3)} className="rounded-full bg-ink px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="mt-6">
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-stone">Step 3 · Your role</p>
            <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">What&apos;s your role at Vaayu?</h2>
            <p className="mt-2 text-sm text-steel">Your title — free-form, 2–40 chars. Pick the suggestion or type your own.</p>
            <input
              autoFocus
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="e.g. Frontend Engineer"
              maxLength={40}
              className="mt-5 w-full rounded-2xl border border-hairline bg-canvas px-4 py-3 text-sm outline-none focus:border-ink placeholder:text-stone/60"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] text-stone">Suggestion:</span>
              {(() => {
                const suggestion = department === "Design" ? "Product Designer" : department === "Engineering" ? "Frontend Engineer" : department === "Marketing" ? "Growth Lead" : "Frontend Engineer";
                return (
                  <button
                    type="button"
                    onClick={() => setJobTitle(suggestion)}
                    className="rounded-full border border-hairline bg-fog px-3 py-1 text-xs font-medium hover:border-ink"
                  >
                    Use “{suggestion}”
                  </button>
                );
              })()}
              <span className="font-mono text-[11px] text-stone">— or type your own. This field is required.</span>
            </div>
            {!canFinish && jobTitle.trim().length === 0 && (
              <p className="mt-2 text-xs text-amber-700">Choose the suggestion or type your title to continue.</p>
            )}
            <p className="mt-2 font-mono text-[11px] text-stone">Shown on your profile and team directory. You can change it anytime in Settings.</p>
            {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
            <div className="mt-6 flex justify-between">
              <button onClick={() => setStep(2)} className="rounded-full border border-hairline px-6 py-2.5 text-sm font-medium">
                Back
              </button>
              <button disabled={!canFinish || saving} onClick={handleFinish} className="rounded-full bg-ink px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
                {saving ? "Saving…" : "Enter workspace →"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
