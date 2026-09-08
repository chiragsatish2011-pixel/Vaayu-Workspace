export type MentionType = "person" | "project" | "file" | "folder" | "checkpoint";

export interface MentionItem {
  type: MentionType;
  id: string;
  label: string;
  sublabel?: string;
  // extra data for rendering / navigation
  email?: string;
  displayName?: string | null;
  avatarDriveId?: string | null;
  mimeType?: string;
  isFolder?: boolean;
  projectId?: string;
  checkpointId?: string;
}

export interface MentionSearchResult {
  type: MentionType;
  id: string;
  label: string;
  sublabel: string;
  // for chip rendering
  color?: string;
  href?: string;
  // raw item for click handling
  raw?: unknown;
}

export function mentionChipColor(type: MentionType): string {
  switch (type) {
    case "person":
      return "bg-violet/10 text-violet border-violet/20";
    case "project":
      return "bg-coral/10 text-coral border-coral/20";
    case "file":
    case "folder":
      return "bg-azure/10 text-azure border-azure/20";
    case "checkpoint":
      return "bg-teal/10 text-teal border-teal/20";
    default:
      return "bg-fog text-ink border-hairline";
  }
}

export function mentionIcon(type: MentionType): string {
  switch (type) {
    case "person":
      return "👤";
    case "project":
      return "📦";
    case "file":
      return "📄";
    case "folder":
      return "📁";
    case "checkpoint":
      return "🚩";
    default:
      return "@";
  }
}
