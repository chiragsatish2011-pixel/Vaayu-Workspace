import { Node, mergeAttributes } from "@tiptap/core";

export interface AudioNoteAttrs {
  driveId: string;
  label?: string | null;
  durationSec?: number | null;
  mimeType?: string | null;
}

/**
 * Block-level atom: a voice note uploaded to Drive, referenced by file id.
 * Stored inside contentJson so chat messages + checkpoints carry it with
 * zero schema changes. Rendered as a chip in the composer and as a full
 * <VoicePlayer/> in sent content (see renderTiptapJsonToReact).
 */
export const AudioNote = Node.create({
  name: "audioNote",

  group: "block",

  atom: true,

  selectable: true,

  draggable: false,

  addAttributes() {
    return {
      driveId: { default: null },
      label: { default: "Voice note" },
      durationSec: { default: null },
      mimeType: { default: "audio/webm" },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-audio-note]" }];
  },

  renderHTML({ node }) {
    const secs = typeof node.attrs.durationSec === "number" ? ` · ${formatVoiceDuration(node.attrs.durationSec)}` : "";
    return [
      "div",
      mergeAttributes({ class: "audio-note-chip", "data-audio-note": "", "data-drive-id": node.attrs.driveId ?? "" }),
      `🎤 ${node.attrs.label || "Voice note"}${secs}`,
    ];
  },
});

export function formatVoiceDuration(totalSec: number | null | undefined): string {
  if (totalSec === null || totalSec === undefined || !Number.isFinite(totalSec)) return "0:00";
  const s = Math.max(0, Math.round(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Plain-text fallback so voice-only content still sends + previews. */
export function audioNotePlaceholder(attrs: { label?: string | null; durationSec?: number | null } | null | undefined): string {
  const label = attrs?.label || "Voice note";
  const secs = typeof attrs?.durationSec === "number" ? ` (${formatVoiceDuration(attrs.durationSec)})` : "";
  return `🎤 ${label}${secs}`;
}
