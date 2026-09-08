"use client";

import { getUserColor, getUserInitials } from "@/lib/userColor";

export function UserAvatar({
  displayName,
  email,
  userId,
  avatarDriveId,
  size = 36,
  className = "",
}: {
  displayName?: string | null;
  email?: string | null;
  userId?: string | null;
  avatarDriveId?: string | null;
  size?: number;
  className?: string;
}) {
  // Deterministic per-user color — ALWAYS from stable identifier (email lowercased, or userId fallback), NEVER displayName.
  // This fixes the Timeline bug where same user ("C" vs "CS") had different colors because we hashed displayName which varies per entry.
  const stableKey = (email && email.trim()) || (userId && userId.trim()) || (displayName && displayName.trim()) || "unknown";
  const color = getUserColor(stableKey);
  const initials = getUserInitials(displayName, email);

  if (avatarDriveId) {
    // Use drive download endpoint for avatar - any logged-in user can view team avatars
    const src = `/api/drive/download?id=${encodeURIComponent(avatarDriveId)}`;
    return (
      <img
        src={src}
        alt={displayName || email || "avatar"}
        width={size}
        height={size}
        className={`shrink-0 rounded-full object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full font-display font-bold text-white ${color.bg} ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      aria-hidden
    >
      {initials}
    </span>
  );
}
