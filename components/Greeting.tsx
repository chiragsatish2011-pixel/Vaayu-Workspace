"use client";

import { useEffect, useState } from "react";

/** Time-aware greeting for the dashboard hero. Client-only, no flash. */
export function Greeting({ fallback = "Welcome" }: { fallback?: string }) {
  const [greeting, setGreeting] = useState(fallback);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Defer to post-paint so the server HTML and first paint match,
    // then swap in the local-time greeting with a soft fade.
    const raf = requestAnimationFrame(() => {
      const h = new Date().getHours();
      setGreeting(
        h < 5
          ? "Up late"
          : h < 12
            ? "Good morning"
            : h < 18
              ? "Good afternoon"
              : "Good evening"
      );
      setReady(true);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <span
      className={`inline-block transition-opacity duration-500 ${
        ready ? "opacity-100" : "opacity-0"
      }`}
    >
      {greeting}
    </span>
  );
}
