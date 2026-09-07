"use client";

/**
 * Folder capture for uploads (CLIENT ONLY).
 *
 * Selecting one top-level folder — via drag-and-drop OR the folder picker —
 * must ALWAYS capture that folder and 100% of its nested contents (all
 * files, all subfolders, all depth levels) as ONE upload batch. Two entry
 * points, zero filtering: if the user selected/dropped it, it goes up —
 * node_modules, .git, .DS_Store, hidden files, lockfiles, everything.
 *
 * - Drag-and-drop walks DataTransferItem entries with webkitGetAsEntry()
 *   and recurses into directories. The plain FileList from a drop event is
 *   NOT used (it flattens/loses structure).
 * - Folder picker uses a real folder-select input (webkitdirectory), so the
 *   OS picker supplies every file with its webkitRelativePath preserved.
 * - readEntries() returns only ONE batch per call in some browsers, so it
 *   is called in a loop until it returns an empty array — otherwise large
 *   folders silently lose files.
 */

export interface PickedUploadFile {
  /** The raw File blob. Untouched — never filtered, never transformed. */
  file: File;
  /**
   * Path of the file inside the picked/dropped tree, "/"-separated, with
   * no leading slash (e.g. "myproj/src/components/App.tsx"). Top-level
   * loose files are just "name.ext". This exact path is what the server
   * uses to recreate the subfolder structure inside the locked Drive
   * folder.
   */
  relativePath: string;
}

function normalizeRelativePath(raw: string): string {
  return raw.replace(/\\/g, "/").replace(/^\/+/, "");
}

/**
 * Files from a picker input: plain <input type="file"> yields bare names;
 * a webkitdirectory folder input yields full webkitRelativePath values.
 * Both are accepted with zero filtering.
 */
export function collectFilesFromInput(
  list: FileList | File[] | null | undefined
): PickedUploadFile[] {
  if (!list) return [];
  return Array.from(list).map((file) => {
    const withPath = file as File & { webkitRelativePath?: unknown };
    const raw =
      typeof withPath.webkitRelativePath === "string" &&
      withPath.webkitRelativePath.length > 0
        ? withPath.webkitRelativePath
        : file.name;
    return { file, relativePath: normalizeRelativePath(raw) || file.name };
  });
}

/* ── DataTransfer directory walk ─────────────────────────────────────── */

interface WebkitFileEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file(success: (file: File) => void, error?: () => void): void;
  createReader(): WebkitDirectoryReader;
}

interface WebkitDirectoryReader {
  readEntries(
    success: (entries: WebkitFileEntry[]) => void,
    error?: () => void
  ): void;
}

interface WebkitDataTransferItem {
  webkitGetAsEntry?: () => WebkitFileEntry | null;
}

function entryFile(entry: WebkitFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    try {
      entry.file(
        resolve,
        () => reject(new Error("Could not read dropped file."))
      );
    } catch (err) {
      reject(
        err instanceof Error ? err : new Error("Could not read dropped file.")
      );
    }
  });
}

function readBatch(reader: WebkitDirectoryReader): Promise<WebkitFileEntry[]> {
  return new Promise((resolve, reject) => {
    try {
      reader.readEntries(
        (entries) => resolve(entries ?? []),
        () => reject(new Error("Could not list dropped folder contents."))
      );
    } catch (err) {
      reject(
        err instanceof Error
          ? err
          : new Error("Could not list dropped folder contents.")
      );
    }
  });
}

/**
 * Recursively collect EVERYTHING under one DataTransfer entry.
 * `prefix` is the already-walked path above this entry ("" at top level).
 */
async function walkEntry(
  entry: WebkitFileEntry,
  prefix: string,
  out: PickedUploadFile[]
): Promise<void> {
  if (entry.isFile) {
    const file = await entryFile(entry);
    // Prefer the live File's name (matches disk); fall back to entry name.
    const leaf = file.name || entry.name || "unnamed";
    out.push({ file, relativePath: `${prefix}${leaf}` });
    return;
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    // GOTCHA: readEntries() returns a single batch per call — loop until
    // it returns [] or large folders silently lose files.
    for (;;) {
      const batch = await readBatch(reader);
      if (batch.length === 0) break;
      for (const child of batch) {
        await walkEntry(child, `${prefix}${entry.name}/`, out);
      }
    }
  }
}

/**
 * Collect every file from a drop event. Uses the DataTransferItem directory
 * walk (full recursive tree, structure preserved); falls back to the plain
 * FileList only when the browser exposes no entry API at all.
 */
export async function collectFilesFromDrop(
  dataTransfer: DataTransfer | null | undefined
): Promise<PickedUploadFile[]> {
  if (!dataTransfer) return [];
  const items = dataTransfer.items ? Array.from(dataTransfer.items) : [];
  const entries = items
    .map((item) => {
      try {
        return (
          (item as unknown as WebkitDataTransferItem).webkitGetAsEntry?.() ??
          null
        );
      } catch {
        return null;
      }
    })
    .filter((e): e is WebkitFileEntry => e !== null);

  if (entries.length === 0) {
    // No entry API (rare) — plain files only, structure unavailable.
    return collectFilesFromInput(dataTransfer.files);
  }

  const out: PickedUploadFile[] = [];
  for (const entry of entries) {
    // A dropped top-level item is always captured whole: a file becomes a
    // single-file batch, a folder becomes the entire recursive tree.
    await walkEntry(entry, "", out);
  }
  return out;
}

/** Total bytes across a picked batch (for honest aggregate progress). */
export function pickedBatchBytes(files: PickedUploadFile[]): number {
  return files.reduce((sum, f) => sum + (f.file.size || 0), 0);
}

/**
 * Distinct top-level roots in a picked batch ("myproj" for
 * "myproj/src/a.ts"; "(files)" for loose top-level files). Display-only.
 */
export function pickedBatchRoots(files: PickedUploadFile[]): string[] {
  const roots = new Set<string>();
  for (const f of files) {
    const slash = f.relativePath.indexOf("/");
    roots.add(slash > 0 ? f.relativePath.slice(0, slash) : "(files)");
  }
  return Array.from(roots);
}
