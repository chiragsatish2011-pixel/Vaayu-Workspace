"use client";

import { getUserColor, getUserInitials } from "@/lib/userColor";

export function UserAvatar({
  displayName,
  email,
  avatarDriveId,
  size = 36,
  className = "",
}: {
  displayName?: string | null;
  email?: string | null;
  avatarDriveId?: string | null;
  size?: number;
  className?: string;
}) {
  const color = getUserColor(displayName || email || "unknown");
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
