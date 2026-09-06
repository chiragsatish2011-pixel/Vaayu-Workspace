/**
 * Instant loading UI for route navigations (used by loading.tsx files).
 * Renders immediately while the server prepares the real page — e.g. the
 * dashboard's database reads after sign-in — so navigation never looks
 * stuck on a dead screen.
 */
export function PageSkeleton() {
  return (
    <div
      aria-hidden
      className="mx-auto w-full max-w-6xl animate-pulse px-4 pb-16 pt-10 sm:px-6 sm:pt-14"
    >
      <div className="h-3 w-40 rounded-full bg-mist" />
      <div className="mt-4 h-12 w-3/4 rounded-xl bg-mist sm:h-16" />
      <div className="mt-3 h-12 w-1/2 rounded-xl bg-fog sm:h-16" />
      <div className="mt-5 h-4 w-full max-w-xl rounded-full bg-fog" />
      <div className="mt-2 h-4 w-2/3 max-w-lg rounded-full bg-fog" />
      <div className="mt-7 flex flex-wrap gap-3">
        <div className="h-12 w-44 rounded-full bg-ink/10" />
        <div className="h-12 w-44 rounded-full bg-fog" />
      </div>
      <div className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-hairline bg-hairline lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-canvas px-6 py-5">
            <div className="h-9 w-16 rounded-lg bg-mist" />
            <div className="mt-2 h-3 w-28 rounded-full bg-fog" />
          </div>
        ))}
      </div>
    </div>
  );
}
