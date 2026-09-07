import { requireJulesApiKey } from "@/lib/env";

const JULES_BASE_URL = "https://jules.googleapis.com/v1alpha";

export function getJulesApiKey(): string {
  return requireJulesApiKey();
}

export async function julesFetch<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  let apiKey = "";
  try {
    apiKey = getJulesApiKey();
  } catch (err: any) {
    return {
      ok: false,
      status: 500,
      data: null,
      error: err?.message || "JULES_API environment variable is not configured.",
    };
  }

  const url = endpoint.startsWith("http")
    ? endpoint
    : `${JULES_BASE_URL}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;

  const headers = new Headers(options.headers || {});
  headers.set("X-Goog-Api-Key", apiKey);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  try {
    const res = await fetch(url, {
      ...options,
      headers,
      cache: "no-store",
    });

    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text as any;
      }
    }

    if (!res.ok) {
      const errMsg =
        data?.error?.message ||
        data?.message ||
        `Jules API request failed with status ${res.status}`;
      return { ok: false, status: res.status, data, error: errMsg };
    }

    return { ok: true, status: res.status, data };
  } catch (err: any) {
    return {
      ok: false,
      status: 500,
      data: null,
      error: err?.message || "Failed to connect to Jules API",
    };
  }
}

export interface SessionStats {
  used24h: number;
  total24hLimit: number;
  remaining24h: number;
  activeConcurrent: number;
  maxConcurrentLimit: number;
  remainingConcurrent: number;
}

export function calculateSessionStats(sessions: any[]): SessionStats {
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  let used24h = 0;
  let activeConcurrent = 0;

  for (const session of sessions) {
    if (!session) continue;

    // Check 24h usage based on createTime
    if (session.createTime) {
      const createDate = new Date(session.createTime);
      if (createDate >= twentyFourHoursAgo) {
        used24h++;
      }
    }

    // Active concurrent sessions: not archived, and state is active/in-progress/waiting
    const isArchived = Boolean(session.archived);
    const state = session.state || "";
    const isEnded = state === "COMPLETED" || state === "FAILED";

    if (!isArchived && !isEnded) {
      activeConcurrent++;
    }
  }

  const total24hLimit = 100;
  const maxConcurrentLimit = 10;

  return {
    used24h,
    total24hLimit,
    remaining24h: Math.max(0, total24hLimit - used24h),
    activeConcurrent,
    maxConcurrentLimit,
    remainingConcurrent: Math.max(0, maxConcurrentLimit - activeConcurrent),
  };
}
