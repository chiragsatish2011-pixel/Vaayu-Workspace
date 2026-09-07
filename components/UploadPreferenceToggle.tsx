"use client";

import { useUploadMode } from "@/components/UploadManager";

/**
 * Upload behavior preference (foreground progress window vs background
 * uploads with the global toast). Stored per browser in localStorage —
 * background is the default.
 */
export function UploadPreferenceToggle() {
  const [mode, setMode] = useUploadMode();
  const background = mode !== "foreground";

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-semibold text-ink">Background uploads</p>
        <p className="mt-0.5 text-xs leading-relaxed text-steel">
          {background
            ? "On — publishing closes the window and tracks progress in the bottom-right toast while you keep working."
            : "Off — publishing keeps a progress window open until the upload finishes."}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={background}
        aria-label="Background uploads"
        onClick={() => setMode(background ? "foreground" : "background")}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ${
          background ? "bg-ink" : "bg-hairline"
        }`}
      >
        <span
          aria-hidden
          className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all duration-200 ${
            background ? "left-6" : "left-1"
          }`}
        />
      </button>
    </div>
  );
}
