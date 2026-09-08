/**
 * Deterministic user color — avatar background when no picture is set.
 * Hashed from user id/email into a curated 12-color palette so it's
 * stable per user, not random per render, and adjacent users rarely
 * collide visually even in dense views (checkpoints, chat, projects).
 */

const PALETTE = [
  { bg: "bg-[#0a0a0a]", text: "text-white", hex: "#0a0a0a" }, // ink
  { bg: "bg-[#1456f0]", text: "text-white", hex: "#1456f0" }, // azure
  { bg: "bg-[#10b981]", text: "text-white", hex: "#10b981" }, // emerald
  { bg: "bg-[#f59e0b]", text: "text-white", hex: "#f59e0b" }, // amber
  { bg: "bg-[#a855f7]", text: "text-white", hex: "#a855f7" }, // violet
  { bg: "bg-[#ff5530]", text: "text-white", hex: "#ff5530" }, // coral
  { bg: "bg-[#22ab94]", text: "text-white", hex: "#22ab94" }, // teal
  { bg: "bg-[#e11d48]", text: "text-white", hex: "#e11d48" }, // rose
  { bg: "bg-[#0e7490]", text: "text-white", hex: "#0e7490" }, // cyan
  { bg: "bg-[#7c3aed]", text: "text-white", hex: "#7c3aed" }, // purple
  { bg: "bg-[#ea580c]", text: "text-white", hex: "#ea580c" }, // orange
  { bg: "bg-[#1d4ed8]", text: "text-white", hex: "#1d4ed8" }, // blue
] as const;

function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function getUserColor(input: string) {
  if (!input) return PALETTE[0];
  const idx = hashString(input.toLowerCase().trim()) % PALETTE.length;
  return PALETTE[idx];
}

export function getDisplayName(displayName?: string | null, email?: string | null): string {
  const raw = displayName && displayName.trim();
  const mail = email && email.trim();
  // If displayName is missing, empty, iso-like, or identical to email (user set email as name), derive from email
  if (!raw || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw) || (mail && raw.toLowerCase() === mail.toLowerCase())) {
    if (!mail) return raw || "Unknown";
    const prefix = mail.split("@")[0] || mail;
    return prefix
      .split(/[._-]+/)
      .filter(Boolean)
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
      .join(" ");
  }
  return raw;
}

export function getUserInitials(displayName?: string | null, email?: string | null): string {
  // Use derived display name so "chirag@vaayu.com" with no explicit name gives "C" not email first char still but consistent
  const effectiveName = getDisplayName(displayName, email);
  const source = effectiveName !== "Unknown" ? effectiveName : email?.trim() || "?";
  if (source.includes(" ")) {
    const parts = source.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2);
  }
  const base = source.trim();
  return (base[0] ?? "?").toUpperCase();
}

export { PALETTE };
