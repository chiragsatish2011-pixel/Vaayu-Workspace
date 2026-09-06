import {
  BoxIcon,
  CallIcon,
  ChatIcon,
  FlagIcon,
  FolderIcon,
} from "@/components/icons";

export type SectionKey = "checkpoints" | "files" | "projects" | "chat" | "calls";

export interface Section {
  key: SectionKey;
  href: string;
  label: string;
  wordmark: string;
  tagline: string;
  blurb: string;
  phase: string;
  badge: { text: string; tone: "new" | "beta" };
  /** Vibrant identity gradient — reserved ONLY for this section. */
  gradient: string;
  /** Flat accent for dots, links, soft chips. */
  accent: string;
  accentText: string;
  accentSoftBg: string;
  icon: (props: React.SVGProps<SVGSVGElement>) => React.ReactNode;
  planned: string[];
}

export const SECTIONS: Section[] = [
  {
    key: "checkpoints",
    href: "/checkpoints",
    label: "Checkpoints",
    wordmark: "Checkpoints",
    tagline: "Track team timeline & progress.",
    blurb: "Add progress notes and milestone updates to keep the team aligned.",
    phase: "Phase 1 · Active timeline",
    badge: { text: "Live", tone: "new" },
    gradient: "from-[#10b981] via-[#059669] to-[#047857]",
    accent: "#10b981",
    accentText: "text-[#047857]",
    accentSoftBg: "bg-[#d1fae5]",
    icon: (p) => <FlagIcon {...p} />,
    planned: [
      "Add notes for timeline milestones (e.g. landing page, mobile theme, bug fixes)",
      "Accessible by all team members (admins and normal users)",
      "Reverse chronological timeline with author roles and timestamps",
    ],
  },
  {
    key: "files",
    href: "/files",
    label: "Files",
    wordmark: "Files",
    tagline: "Every team file, one browser.",
    blurb:
      "Browse, upload and manage the shared drive from inside your workspace.",
    phase: "Phase 2 · Drive integration",
    badge: { text: "Phase 2", tone: "beta" },
    gradient:
      "from-[#1456f0] via-[#2f6bf3] to-[#3daeff]",
    accent: "#1456f0",
    accentText: "text-azure-deep",
    accentSoftBg: "bg-azure-soft",
    icon: (p) => <FolderIcon {...p} />,
    planned: [
      "Server-side Drive connection — your files, zero credential exposure",
      "File browser: list, upload, download and delete through one API",
      "Automatic compression on upload to stretch every gigabyte",
    ],
  },
  {
    key: "projects",
    href: "/projects",
    label: "Projects",
    wordmark: "Projects",
    tagline: "Ship code as packages, not threads.",
    blurb:
      "Publish described, previewable project bundles backed by Google Drive.",
    phase: "Phase 2b · Live storage",
    badge: { text: "Live", tone: "new" },
    gradient:
      "from-[#ff5530] via-[#f9603a] to-[#ea5ec1]",
    accent: "#ff5530",
    accentText: "text-coral-deep",
    accentSoftBg: "bg-[#ffe9e1]",
    icon: (p) => <BoxIcon {...p} />,
    planned: [
      "Upload form: title, description, preview image + compressed bundle",
      "Interactive cards with live image lightbox and one-click download",
      "Direct Google Drive cloud backend with zero credential exposure",
    ],
  },
  {
    key: "chat",
    href: "/chat",
    label: "Chat",
    wordmark: "Chat",
    tagline: "Talk where the work lives.",
    blurb: "Real-time channels per project with persistent history.",
    phase: "Phase 3 · Realtime chat",
    badge: { text: "Phase 3", tone: "beta" },
    gradient:
      "from-[#a855f7] via-[#8b5cf6] to-[#ea5ec1]",
    accent: "#a855f7",
    accentText: "text-[#7c3aed]",
    accentSoftBg: "bg-[#f1e8ff]",
    icon: (p) => <ChatIcon {...p} />,
    planned: [
      "Live channels powered by Pusher or Ably under the hood",
      "Message history in Postgres — nothing important scrolls away",
      "One channel per project, plus team-wide announcements",
    ],
  },
  {
    key: "calls",
    href: "/calls",
    label: "Calls",
    wordmark: "Calls",
    tagline: "One click, face to face.",
    blurb: "Voice and video rooms launched straight from a channel.",
    phase: "Phase 4 · Voice & video",
    badge: { text: "Phase 4", tone: "beta" },
    gradient:
      "from-[#0e7a64] via-[#22ab94] to-[#3daeff]",
    accent: "#22ab94",
    accentText: "text-teal-deep",
    accentSoftBg: "bg-[#dcf5ee]",
    icon: (p) => <CallIcon {...p} />,
    planned: [
      "Start-call button that spins up a room via LiveKit or Daily",
      "Embedded call UI — no links, no context switching",
      "Voice-first default with video one tap away",
    ],
  },
];

export const sectionByKey = (key: SectionKey): Section =>
  SECTIONS.find((s) => s.key === key) ?? SECTIONS[0];
