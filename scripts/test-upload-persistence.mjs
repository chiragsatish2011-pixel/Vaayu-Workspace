/**
 * Regression test: the upload widget must be TRULY global.
 *
 * Guards the architecture Requirement 1 depends on:
 *  1. <UploadProvider> is mounted exactly once, in app/providers.tsx
 *     (inside the ROOT layout) — never inside a page/route component,
 *     so App Router navigation can never unmount it mid-upload.
 *  2. The root layout renders <Providers> (provider sits above every route).
 *  3. No page/route file mounts its own UploadProvider (a second provider
 *     would fork upload state and lose progress on navigation).
 *  4. The toast renders in a fixed bottom-right overlay (never in page flow,
 *     so route content can never push it off-screen or unmount it).
 *  5. Settle handlers resurface the toast (dismissing mid-upload cannot
 *     swallow the completion beat).
 *
 * Run: node scripts/test-upload-persistence.mjs
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WS = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(WS, p), "utf8");

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

// 1. Single global mount point.
const providers = read("app/providers.tsx");
assert.match(providers, /<UploadProvider>/, "providers.tsx must mount <UploadProvider>");
assert.match(
  providers,
  /<UploadProvider>\{children\}<\/UploadProvider>/,
  "UploadProvider must wrap {children} so every route is inside it"
);

// 2. Root layout renders Providers above all routes.
const layout = read("app/layout.tsx");
assert.match(layout, /<Providers>\{children\}<\/Providers>/, "root layout must render <Providers>{children}</Providers>");

// 3. No other file mounts UploadProvider (no forked upload state).
const mounters = walk(path.join(WS, "app"))
  .concat(walk(path.join(WS, "components")))
  .filter((f) => !f.endsWith("UploadManager.tsx") && !f.endsWith("providers.tsx"))
  .filter((f) => /<UploadProvider[\s>]/.test(fs.readFileSync(f, "utf8")));
assert.deepStrictEqual(
  mounters.map((f) => path.relative(WS, f)),
  [],
  "no page/component may mount its own <UploadProvider>"
);

// 4. Toast is a fixed bottom-right overlay, not page flow.
const manager = read("components/UploadManager.tsx");
assert.match(manager, /fixed bottom-4 right-4/, "toast must be fixed bottom-right");
assert.match(manager, /z-\[80\]/, "toast must float above header/drawer/modals");
assert.ok(
  !/UploadToast[\s\S]{0,400}?absolute/.test(manager.split("function UploadToast")[1] ?? ""),
  "toast must not use absolute positioning inside page flow"
);

// 5. Settle handlers resurface a dismissed toast (both outcomes).
const runTask = manager.split("const runTask")[1].split("const track")[0];
assert.match(runTask, /status: "done"[\s\S]{0,400}?setOpen\(true\)/, "done must resurface the toast");
assert.match(runTask, /status: "error"[\s\S]{0,400}?setOpen\(true\)/, "error must resurface the toast");

// 6. Upload state lives in provider scope (useState/useRef inside
//    UploadProvider), never in a page component.
const providerBody = manager.split("export function UploadProvider")[1].split("/* ── Global")[0];
assert.match(providerBody, /useState<UploadJob\[\]>/, "jobs state must live in UploadProvider");
assert.match(providerBody, /useRef\(new Map/, "task registry must live in UploadProvider");

console.log("Upload persistence architecture: all 6 checks passed.");
console.log("- <UploadProvider> mounted once in root layout (never unmounts on navigation)");
console.log("- toast is a fixed z-[80] bottom-right overlay (never in page flow)");
console.log("- done/error always resurface a dismissed toast; state lives above all routes");
