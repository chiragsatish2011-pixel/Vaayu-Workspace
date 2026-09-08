/**
 * Chat notification helpers — mirrors callNotifications pattern but for chat.
 * - Permission must be requested inside a user gesture (Allow click)
 * - If Blocked, we cannot re-prompt; user must change in browser site settings
 * - Browser notifications only work while browser is open (even backgrounded)
 */

export type ChatNotificationPermission = NotificationPermission | "unsupported";

export const CHAT_ENABLED_KEY = "vaayu:chat-notifications:enabled";
export const CHAT_PREPROMPT_DISMISSED_KEY = "vaayu:chat-notifications:preprompt-dismissed";

function keyForUser(base: string, userId?: string | null): string {
  return userId ? `${base}:${userId}` : base;
}

export function isChatNotificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function getChatNotificationPermission(): ChatNotificationPermission {
  if (!isChatNotificationSupported()) return "unsupported";
  return Notification.permission as ChatNotificationPermission;
}

export function canRequestChatPermission(): boolean {
  return isChatNotificationSupported() && Notification.permission === "default";
}

export async function requestChatNotificationPermission(): Promise<NotificationPermission> {
  if (!isChatNotificationSupported()) return "denied" as NotificationPermission;
  if (Notification.permission !== "default") return Notification.permission;
  return Notification.requestPermission();
}

export function getChatAppEnabled(userId?: string | null): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(keyForUser(CHAT_ENABLED_KEY, userId));
    if (raw === null) return getChatNotificationPermission() === "granted";
    return raw === "1" || raw === "true";
  } catch {
    return false;
  }
}

export function setChatAppEnabled(enabled: boolean, userId?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(keyForUser(CHAT_ENABLED_KEY, userId), enabled ? "1" : "0");
  } catch {}
}

export function isChatPrePromptDismissed(userId?: string | null): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(keyForUser(CHAT_PREPROMPT_DISMISSED_KEY, userId)) === "1";
  } catch {
    return false;
  }
}

export function setChatPrePromptDismissed(dismissed: boolean, userId?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (dismissed) window.localStorage.setItem(keyForUser(CHAT_PREPROMPT_DISMISSED_KEY, userId), "1");
    else window.localStorage.removeItem(keyForUser(CHAT_PREPROMPT_DISMISSED_KEY, userId));
  } catch {}
}

export function shouldShowChatPrePrompt(permission: ChatNotificationPermission, dismissed: boolean): boolean {
  return permission === "default" && !dismissed;
}

export function triggerChatNotification(opts: {
  title: string;
  body: string;
  tag?: string;
  userId?: string | null;
}): boolean {
  const { title, body, tag, userId } = opts;
  if (!isChatNotificationSupported()) return false;
  if (getChatNotificationPermission() !== "granted") return false;
  if (!getChatAppEnabled(userId)) return false;
  try {
    const n = new Notification(title, {
      body,
      icon: "/favicon.ico",
      tag: tag || "vaayu-chat",
      requireInteraction: false,
    } as NotificationOptions);
    n.onclick = () => {
      try {
        window.focus();
        window.location.assign("/chat");
      } catch {}
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}
