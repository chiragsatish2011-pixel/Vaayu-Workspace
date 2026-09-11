import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Analytics } from "@vercel/analytics/next";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Vaayu Workspace",
  description:
    "One workspace for your whole team — files, projects, chat and calls.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${spaceGrotesk.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Theme init — runs before first paint so dark mode never flashes
            light. Mirrors components/ThemeToggle.tsx (storage keys +
            system fallback must stay in sync). Also applies the workspace
            accent early and clears any stale inline --color-ink left by
            older builds (accent must never own the text color). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('vaayu:theme');var d=t==='dark'||((!t||t==='system')&&matchMedia('(prefers-color-scheme: dark)').matches);if(d){document.documentElement.classList.add('dark')}document.documentElement.style.colorScheme=d?'dark':'light'}catch(e){}try{var a=localStorage.getItem('vaayu:workspace:accent');document.documentElement.style.removeProperty('--color-ink');if(a&&a!=='#0a0a0a'){document.documentElement.setAttribute('data-accent','custom');document.documentElement.style.setProperty('--workspace-accent',a)}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="flex min-h-full flex-col bg-canvas font-sans text-ink">
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
