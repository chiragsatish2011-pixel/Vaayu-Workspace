import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep builds strict — type errors are now surfaced (fixed from original ignoreBuildErrors:true which hid regressions like the A:I vs A:J delete bug)
  typescript: { ignoreBuildErrors: false },
  experimental: {
    optimizePackageImports: ["tippy.js", "chonky2", "@tiptap/react", "@tiptap/starter-kit", "@tiptap/extension-mention", "@tiptap/extension-placeholder"],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // HSTS only in production (Vercel HTTPS)
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

export default nextConfig;
