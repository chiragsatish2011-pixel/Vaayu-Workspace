"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Scroll-reveal wrapper — fades content up the first time it enters the
 * viewport. Pure IntersectionObserver + CSS, no animation library.
 */
export function Reveal({
  children,
  delay = 0,
  className = "",
  as: Tag = "div",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "section" | "li" | "span";
}) {
  const ref = useRef<HTMLElement | null>(null);
  // No IntersectionObserver (very old browsers / SSR) → visible immediately.
  const [visible, setVisible] = useState(
    () => typeof IntersectionObserver === "undefined"
  );

  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            io.disconnect();
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  const Component = Tag as React.ElementType;
  return (
    <Component
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`reveal${visible ? " is-visible" : ""}${
        className ? ` ${className}` : ""
      }`}
    >
      {children}
    </Component>
  );
}
