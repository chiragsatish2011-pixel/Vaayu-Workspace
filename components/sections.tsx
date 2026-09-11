import {
  BoxIcon,
  CallIcon,
  ChatIcon,
  FlagIcon,
  FolderIcon,
} from "@/components/icons";

export type SectionKey = "checkpoints" | "files" | "projects" | "chat";

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
    phase: "Live · Active timeline",
    badge: { text: "Live", tone: "new" },
    gradient: "from-[#10b981] via-[#059669] to-[#047857]",
    accent: "#10b981",
    accentText: "text-[#047857]",
    accentSoftBg: "bg-[#d1fae5]",
    icon: (p) => <FlagIcon {...p} />,
    planned: [
      "Add notes for timeline milestones the whole team can follow",
      "Visible to the whole team, with authors and timestamps",
      "Newest-first timeline so recent progress is always on top",
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
    phase: "Live · Team browser",
    badge: { text: "Live", tone: "new" },
    gradient:
      "from-[#1456f0] via-[#2f6bf3] to-[#3daeff]",
    accent: "#1456f0",
    accentText: "text-azure-deep",
    accentSoftBg: "bg-azure-soft",
    icon: (p) => <FolderIcon {...p} />,
    planned: [
      "Shared team storage — your files, always in sync",
      "File browser: browse, upload, download and organize in one place",
      "Automatic compression on upload to save space",
    ],
  },
  {
    key: "projects",
    href: "/projects",
    label: "Projects",
    wordmark: "Projects",
    tagline: "Ship code as packages, not threads.",
    blurb:
      "Publish described, previewable project bundles backed by secure team storage.",
    phase: "Live · Team storage",
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
      "Cloud-backed storage, always available to the team",
    ],
  },
  {
    key: "chat",
    href: "/chat",
    label: "Chat",
    wordmark: "Chat",
    tagline: "Talk where the work lives.",
    blurb: "Real-time channels per project with persistent history.",
    phase: "Live · Realtime chat",
    badge: { text: "Live", tone: "new" },
    gradient:
      "from-[#a855f7] via-[#8b5cf6] to-[#ea5ec1]",
    accent: "#a855f7",
    accentText: "text-[#7c3aed]",
    accentSoftBg: "bg-[#f1e8ff]",
    icon: (p) => <ChatIcon {...p} />,
    planned: [
      "Live channels with instant delivery",
      "Full message history — nothing important scrolls away",
      "One channel per project, plus team-wide announcements",
    ],
  },
  // Calls is temporarily disabled (Daily.co now requires a payment method for every room).
  // Kept in git history; re-add by restoring this entry. /calls shows a parked notice.
  // {
  //   key: "calls",
  //   href: "/calls",
  //   label: "Calls",
  //   wordmark: "Calls",
  //   tagline: "Paused — payment wall, coming back via free provider.",
  //   blurb: "Temporarily disabled. Was: Voice/video via Daily.co SFU.",
  //   phase: "Paused",
  //   badge: { text: "Paused", tone: "beta" },
  //   gradient: "from-[#0e7a64] via-[#22ab94] to-[#3daeff]",
  //   accent: "#22ab94",
  //   accentText: "text-teal-deep",
  //   accentSoftBg: "bg-[#dcf5ee]",
  //   icon: (p) => <CallIcon {...p} />,
  //   planned: ["Paused — see /calls notice"],
  // },
];

export const sectionByKey = (key: SectionKey): Section =>
  SECTIONS.find((s) => s.key === key) ?? SECTIONS[0];
