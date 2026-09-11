"use client";

import { useState } from "react";
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
  const [imgFailed, setImgFailed] = useState(false);
  // Deterministic per-user color — ALWAYS from stable identifier (email lowercased, or userId fallback), NEVER displayName.
  // This fixes the Timeline bug where same user ("C" vs "CS") had different colors because we hashed displayName which varies per entry.
  const stableKey = (email && email.trim()) || (userId && userId.trim()) || (displayName && displayName.trim()) || "unknown";
  const color = getUserColor(stableKey);
  const initials = getUserInitials(displayName, email);

  if (avatarDriveId && !imgFailed) {
    const src = `/api/drive/download?id=${encodeURIComponent(avatarDriveId)}`;
    return (
      <img
        src={src}
        alt={displayName || email || "avatar"}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setImgFailed(true)}
        className={`shrink-0 rounded-full object-cover border border-white/20 shadow-sm ${className}`}
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

export function GroupAvatarCollage({
  members,
  size = 44,
  className = "",
}: {
  members: Array<{ displayName?: string | null; email: string; userId?: string | null; avatarDriveId?: string | null }>;
  size?: number;
  className?: string;
}) {
  const count = members.length;
  if (count === 0) {
    return (
      <span className={`grid place-items-center rounded-full bg-fog text-steel ${className}`} style={{ width: size, height: size }}>
        <svg viewBox="0 0 24 24" className="h-[55%] w-[55%]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      </span>
    );
  }
  if (count === 1) {
    const m = members[0]!;
    return <UserAvatar displayName={m.displayName} email={m.email} userId={m.userId} avatarDriveId={m.avatarDriveId} size={size} className={className} />;
  }
  // For 2 members: side-by-side overlapping
  if (count === 2) {
    const [a, b] = members;
    return (
      <span className={`relative grid place-items-center shrink-0 ${className}`} style={{ width: size, height: size }} aria-hidden>
        <span className="absolute left-0 top-1/2 -translate-y-1/2 rounded-full ring-2 ring-white shadow-sm" style={{ width: size * 0.62, height: size * 0.62 }}>
          <UserAvatar displayName={a!.displayName} email={a!.email} userId={a!.userId} avatarDriveId={a!.avatarDriveId} size={size * 0.62} className="h-full w-full" />
        </span>
        <span className="absolute right-0 top-1/2 -translate-y-1/2 rounded-full ring-2 ring-white shadow-sm" style={{ width: size * 0.62, height: size * 0.62 }}>
          <UserAvatar displayName={b!.displayName} email={b!.email} userId={b!.userId} avatarDriveId={b!.avatarDriveId} size={size * 0.62} className="h-full w-full" />
        </span>
      </span>
    );
  }
  // For 3 members: triangle
  if (count === 3) {
    return (
      <span className={`relative grid place-items-center shrink-0 overflow-hidden rounded-full bg-fog ring-1 ring-hairline-soft ${className}`} style={{ width: size, height: size }}>
        <span className="absolute left-1/2 top-[6%] -translate-x-1/2 rounded-full ring-2 ring-white shadow-sm" style={{ width: size * 0.52, height: size * 0.52 }}>
          <UserAvatar displayName={members[0]!.displayName} email={members[0]!.email} userId={members[0]!.userId} avatarDriveId={members[0]!.avatarDriveId} size={size * 0.52} className="h-full w-full" />
        </span>
        <span className="absolute bottom-[6%] left-[6%] rounded-full ring-2 ring-white shadow-sm" style={{ width: size * 0.48, height: size * 0.48 }}>
          <UserAvatar displayName={members[1]!.displayName} email={members[1]!.email} userId={members[1]!.userId} avatarDriveId={members[1]!.avatarDriveId} size={size * 0.48} className="h-full w-full" />
        </span>
        <span className="absolute bottom-[6%] right-[6%] rounded-full ring-2 ring-white shadow-sm" style={{ width: size * 0.48, height: size * 0.48 }}>
          <UserAvatar displayName={members[2]!.displayName} email={members[2]!.email} userId={members[2]!.userId} avatarDriveId={members[2]!.avatarDriveId} size={size * 0.48} className="h-full w-full" />
        </span>
      </span>
    );
  }
  // For 4 members: 2x2 grid
  if (count === 4) {
    return (
      <span className={`relative grid shrink-0 overflow-hidden rounded-full bg-fog ring-1 ring-hairline-soft ${className}`} style={{ width: size, height: size }}>
        <span className="absolute left-0 top-0 rounded-full ring-2 ring-white shadow-sm" style={{ width: size * 0.52, height: size * 0.52 }}>
          <UserAvatar displayName={members[0]!.displayName} email={members[0]!.email} userId={members[0]!.userId} avatarDriveId={members[0]!.avatarDriveId} size={size * 0.52} className="h-full w-full" />
        </span>
        <span className="absolute right-0 top-0 rounded-full ring-2 ring-white shadow-sm" style={{ width: size * 0.52, height: size * 0.52 }}>
          <UserAvatar displayName={members[1]!.displayName} email={members[1]!.email} userId={members[1]!.userId} avatarDriveId={members[1]!.avatarDriveId} size={size * 0.52} className="h-full w-full" />
        </span>
        <span className="absolute bottom-0 left-0 rounded-full ring-2 ring-white shadow-sm" style={{ width: size * 0.52, height: size * 0.52 }}>
          <UserAvatar displayName={members[2]!.displayName} email={members[2]!.email} userId={members[2]!.userId} avatarDriveId={members[2]!.avatarDriveId} size={size * 0.52} className="h-full w-full" />
        </span>
        <span className="absolute bottom-0 right-0 rounded-full ring-2 ring-white shadow-sm" style={{ width: size * 0.52, height: size * 0.52 }}>
          <UserAvatar displayName={members[3]!.displayName} email={members[3]!.email} userId={members[3]!.userId} avatarDriveId={members[3]!.avatarDriveId} size={size * 0.52} className="h-full w-full" />
        </span>
      </span>
    );
  }
  // For 5+ members: 2x2 with +N
  const visible = members.slice(0, 3);
  const remaining = count - 3;
  return (
    <span className={`relative grid shrink-0 overflow-hidden rounded-full bg-fog ring-1 ring-hairline-soft ${className}`} style={{ width: size, height: size }}>
      <span className="absolute left-0 top-0 rounded-full ring-2 ring-white shadow-sm" style={{ width: size * 0.52, height: size * 0.52 }}>
        <UserAvatar displayName={visible[0]!.displayName} email={visible[0]!.email} userId={visible[0]!.userId} avatarDriveId={visible[0]!.avatarDriveId} size={size * 0.52} className="h-full w-full" />
      </span>
      <span className="absolute right-0 top-0 rounded-full ring-2 ring-white shadow-sm" style={{ width: size * 0.52, height: size * 0.52 }}>
        <UserAvatar displayName={visible[1]!.displayName} email={visible[1]!.email} userId={visible[1]!.userId} avatarDriveId={visible[1]!.avatarDriveId} size={size * 0.52} className="h-full w-full" />
      </span>
      <span className="absolute bottom-0 left-0 rounded-full ring-2 ring-white shadow-sm" style={{ width: size * 0.52, height: size * 0.52 }}>
        <UserAvatar displayName={visible[2]!.displayName} email={visible[2]!.email} userId={visible[2]!.userId} avatarDriveId={visible[2]!.avatarDriveId} size={size * 0.52} className="h-full w-full" />
      </span>
      <span className="absolute bottom-0 right-0 grid place-items-center rounded-full bg-ink text-white ring-2 ring-white shadow-sm" style={{ width: size * 0.52, height: size * 0.52, fontSize: size * 0.22 }}>
        +{remaining}
      </span>
    </span>
  );
}
