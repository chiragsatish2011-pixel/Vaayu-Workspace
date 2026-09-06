import { ComingSoon } from "@/components/ComingSoon";

// Protected, per-user page (ComingSoon reads the session) — always render
// per request, never prerender at build time.
export const dynamic = "force-dynamic";

export default function CallsPage() {
  return <ComingSoon section="calls" />;
}
