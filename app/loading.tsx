import { PageSkeleton } from "@/components/PageSkeleton";

/** Shown instantly while the dashboard loads (e.g. right after sign-in). */
export default function Loading() {
  return <PageSkeleton />;
}
