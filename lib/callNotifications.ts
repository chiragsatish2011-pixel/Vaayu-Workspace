/**
 * Call notification helpers — honest about real browser constraints.
 *
 * 1. Permission can NEVER be silently granted. The browser's native dialog
 *    must appear and be manually accepted at least once. No website can
 *    bypass it.
 * 2. If the user clicks "Block", we cannot re-prompt — they must change it
 *    in browser site settings. We show a calm explanation instead.
 * 3. requestPermission() MUST be triggered directly by a user gesture
 *    (button click), otherwise browsers will refuse it.
 * 4. Web-based notifications only work while the browser is open (even if
 *    backgrounded/minimized). True "ringing while laptop closed" requires a
 *    native app with system-level push — that's a future step.
 */

export type CallNotificationPermission = NotificationPermission | "unsupported";

export const APP_ENABLED_KEY = "vaayu:call-notifications:enabled";
export const PREPROMPT_DISMISSED_KEY = "vaayu:call-notifications:preprompt-dismissed";

function keyForUser(base: string, userId?: string | null): string {
  return userId ? `${base}:${userId}` : base;
}

export function isNotificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function getNotificationPermission(): CallNotificationPermission {
  if (!isNotificationSupported()) return "unsupported";
  // Notification.permission is always one of "granted" | "denied" | "default"
  return Notification.permission as CallNotificationPermission;
}

/** Whether we can show the browser's one-shot prompt (requires default + supported). */
export function canRequestPermission(): boolean {
  return isNotificationSupported() && Notification.permission === "default";
}

/**
 * Must be called from a direct user gesture (click). Triggers the real
 * one-shot browser permission dialog. Never call on page load.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isNotificationSupported()) return "denied" as NotificationPermission;
  if (Notification.permission !== "default") return Notification.permission;
  // This is the only place we ever call requestPermission — gesture-gated.
  const result = await Notification.requestPermission();
  return result;
}

export function getAppEnabled(userId?: string | null): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(keyForUser(APP_ENABLED_KEY, userId));
    if (raw === null) {
      // Default: enabled if browser permission already granted, otherwise false
      // (user hasn't opted in yet). This keeps the toggle honest.
      return getNotificationPermission() === "granted";
    }
    return raw === "1" || raw === "true";
  } catch {
    return false;
  }
}

export function setAppEnabled(enabled: boolean, userId?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(keyForUser(APP_ENABLED_KEY, userId), enabled ? "1" : "0");
  } catch {}
}

export function isPrePromptDismissed(userId?: string | null): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(keyForUser(PREPROMPT_DISMISSED_KEY, userId)) === "1";
  } catch {
    return false;
  }
}

export function setPrePromptDismissed(dismissed: boolean, userId?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (dismissed) window.localStorage.setItem(keyForUser(PREPROMPT_DISMISSED_KEY, userId), "1");
    else window.localStorage.removeItem(keyForUser(PREPROMPT_DISMISSED_KEY, userId));
  } catch {}
}

/** Whether to show the friendly pre-prompt before the real browser dialog. */
export function shouldShowPrePrompt(permission: CallNotificationPermission, dismissed: boolean): boolean {
  return permission === "default" && !dismissed;
}

/**
 * Fire a browser Notification for an incoming call, if permitted and enabled.
 * Clicking the notification focuses the tab and navigates to the call.
 * Returns true if a notification was shown.
 */
export function triggerIncomingCallNotification(opts: {
  title: string;
  body: string;
  joinUrl?: string; // e.g. "/calls?join=roomName"
  userId?: string | null;
}): boolean {
  const { title, body, joinUrl, userId } = opts;
  if (!isNotificationSupported()) return false;
  if (getNotificationPermission() !== "granted") return false;
  if (!getAppEnabled(userId)) return false;
  // Even if tab is visible, also show browser notification if permission granted —
  // it will appear when backgrounded and is harmless when focused.
  try {
    const n = new Notification(title, {
      body,
      icon: "/favicon.ico",
      tag: "vaayu-incoming-call",
      requireInteraction: true,
    } as NotificationOptions);
    n.onclick = () => {
      try {
        window.focus();
      } catch {}
      if (joinUrl) {
        try {
          window.location.assign(joinUrl);
        } catch {}
      }
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}
