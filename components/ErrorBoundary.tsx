"use client";

import React from "react";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.name || "unknown"}]`, error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center dark:border-amber-900/60 dark:bg-[#211a0d]">
          <p className="font-display text-base font-bold text-amber-900 dark:text-amber-100">Something went wrong here</p>
          <p className="mt-1 text-sm text-amber-800 dark:text-amber-100/80">This section failed to load, but the rest of the workspace is still working.</p>
          <pre className="mt-3 max-h-24 overflow-auto rounded-lg border border-amber-200 bg-white p-3 text-left font-mono text-xs text-ink break-words whitespace-pre-wrap dark:border-amber-900/60 dark:bg-black/40">
            {this.state.error?.message ?? "Unknown error"}
          </pre>
          <div className="mt-4 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, error: null })}
              className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-charcoal dark:text-[#09090b]"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-full border border-hairline bg-white px-4 py-2 text-sm font-semibold hover:border-ink dark:bg-transparent"
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function InlineErrorFallback({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-hairline bg-canvas p-6 text-center">
      <p className="text-sm font-medium text-ink">Couldn’t load this section</p>
      <p className="mt-1 text-xs text-steel">{message || "Please try again."}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-3 rounded-full border border-hairline px-4 py-1.5 text-xs font-semibold hover:border-ink">
          Retry
        </button>
      )}
    </div>
  );
}
