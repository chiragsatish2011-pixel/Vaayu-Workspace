"use client";

import { getSession, signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AuthError,
  AuthField,
  AuthLayout,
  AuthSubmit,
} from "@/components/AuthLayout";
import { SetupBanner } from "@/components/SetupBanner";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await signIn("credentials", {
        email: email.trim(),
        password,
        redirect: false,
      });
      if (res?.error) {
        setError("Invalid email or password.");
      } else if (res?.ok) {
        // Fresh session carries mustChangePassword — route accordingly.
        const fresh = await getSession();
        router.push(fresh?.user?.mustChangePassword ? "/set-password" : "/");
        router.refresh();
      } else {
        setError("Could not sign in. Please try again.");
      }
    } catch {
      setError("Could not sign in. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      eyebrow="Sign in"
      title="Welcome back."
      subtitle="Pick up exactly where your team left off."
      footer={
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-stone">
          Private workspace · accounts are created by your admin
        </span>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <SetupBanner />
        <AuthField
          label="Email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@team.com"
        />
        <AuthField
          label="Password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
        />
        {error && <AuthError message={error} />}
        <div className="pt-1">
          <AuthSubmit loading={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </AuthSubmit>
        </div>
      </form>
    </AuthLayout>
  );
}
