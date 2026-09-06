"use client";

import { useState, useRef } from "react";
import { Badge } from "@/components/Badge";
import {
  BoxIcon,
  CheckIcon,
  FolderIcon,
  SearchIcon,
  TrashIcon,
} from "@/components/icons";

export interface ProjectItem {
  id: string;
  title: string;
  description: string;
  codebaseDriveId: string;
  codebaseFileName: string;
  codebaseFileSize: string;
  previewDriveId: string | null;
  previewFileName: string | null;
  createdAt: string;
  updatedAt: string;
  userId: string;
  userEmail: string;
  userRole: "admin" | "member";
}

interface ProjectsManagerProps {
  initialProjects: ProjectItem[];
  currentUser: {
    id: string;
    email: string;
    role: "admin" | "member";
  };
}

export function ProjectsManager({
  initialProjects,
  currentUser,
}: ProjectsManagerProps) {
  const [projects, setProjects] = useState<ProjectItem[]>(initialProjects);
  const [searchQuery, setSearchQuery] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<{
    url: string;
    title: string;
  } | null>(null);

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [codebaseFile, setCodebaseFile] = useState<File | null>(null);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const codebaseInputRef = useRef<HTMLInputElement>(null);
  const previewInputRef = useRef<HTMLInputElement>(null);

  const handlePreviewChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPreviewFile(file);
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    }
  };

  const handleCodebaseChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCodebaseFile(file);
    }
  };

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setCodebaseFile(null);
    setPreviewFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    setFormError(null);
    if (codebaseInputRef.current) codebaseInputRef.current.value = "";
    if (previewInputRef.current) previewInputRef.current.value = "";
  };

  const handleCloseModal = () => {
    if (submitting) return;
    resetForm();
    setIsModalOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setFormError("Project title is required.");
      return;
    }
    if (!description.trim()) {
      setFormError("Project description is required.");
      return;
    }
    if (!codebaseFile) {
      setFormError("Please select a compressed codebase file (.zip or .tar.gz).");
      return;
    }

    setSubmitting(true);
    setFormError(null);

    const formData = new FormData();
    formData.append("title", title.trim());
    formData.append("description", description.trim());
    formData.append("codebase", codebaseFile);
    if (previewFile) {
      formData.append("preview", previewFile);
    }

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create project.");
      }

      setProjects((prev) => [data.project, ...prev]);
      handleCloseModal();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (projectId: string, projectTitle: string) => {
    if (
      !window.confirm(
        `Are you sure you want to delete "${projectTitle}" and its files from Google Drive?`
      )
    ) {
      return;
    }

    setDeletingId(projectId);
    try {
      const res = await fetch(`/api/projects?id=${encodeURIComponent(projectId)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to delete project.");
      }
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete project.");
    } finally {
      setDeletingId(null);
    }
  };

  const filteredProjects = projects.filter((p) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      p.title.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.userEmail.toLowerCase().includes(q) ||
      p.codebaseFileName.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-8">
      {/* ── Action Toolbar ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-steel pointer-events-none" />
          <input
            type="text"
            placeholder="Search projects by name, description, author..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-2xl border border-hairline bg-canvas pl-10 pr-4 py-2.5 text-sm text-ink placeholder:text-steel focus:border-ink focus:outline-none transition-colors"
          />
        </div>

        {/* Upload Button */}
        <div className="flex items-center gap-3">
          <Badge tone="live" className="hidden sm:inline-flex">
            Drive Storage Active
          </Badge>
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="press inline-flex items-center gap-2 rounded-full bg-ink px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-charcoal transition-colors"
          >
            <BoxIcon className="h-4 w-4" />
            Publish Project
          </button>
        </div>
      </div>

      {/* ── Projects Grid ── */}
      {filteredProjects.length === 0 ? (
        <div className="rounded-3xl border border-hairline-soft bg-fog/60 p-12 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-canvas border border-hairline shadow-sm text-steel">
            <BoxIcon className="h-7 w-7 text-ink" />
          </div>
          <h3 className="mt-4 font-display text-xl font-bold tracking-tight text-ink">
            {searchQuery ? "No matching projects found" : "No project bundles yet"}
          </h3>
          <p className="mt-2 text-sm text-steel max-w-md mx-auto">
            {searchQuery
              ? "Try tweaking your search term to find what you need."
              : "Publish your first codebase bundle with description, preview image, and compressed archive directly to Google Drive."}
          </p>
          {!searchQuery && (
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-ink px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-charcoal transition-colors"
            >
              <BoxIcon className="h-4 w-4" />
              Publish First Project
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filteredProjects.map((p) => {
            const canDelete = currentUser.role === "admin" || currentUser.id === p.userId;
            const previewImageUrl = p.previewDriveId
              ? `/api/drive/download?id=${encodeURIComponent(p.previewDriveId)}`
              : null;

            return (
              <div
                key={p.id}
                className="group flex flex-col justify-between rounded-3xl border border-hairline bg-canvas overflow-hidden hover:border-ink/50 hover:shadow-lg transition-all duration-300"
              >
                <div>
                  {/* Preview Image / Header Banner */}
                  <div className="relative aspect-video w-full overflow-hidden bg-fog border-b border-hairline-soft">
                    {previewImageUrl ? (
                      <div className="relative h-full w-full group/img cursor-pointer" onClick={() => setLightboxImage({ url: previewImageUrl, title: p.title })}>
                        <img
                          src={previewImageUrl}
                          alt={p.title}
                          className="h-full w-full object-cover transition-transform duration-300 group-hover/img:scale-105"
                          loading="lazy"
                        />
                        <div className="absolute inset-0 bg-ink/20 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center">
                          <span className="rounded-full bg-white/90 backdrop-blur-sm px-3 py-1 text-xs font-semibold text-ink shadow-sm">
                            Click to Expand
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#ff5530]/10 via-[#f9603a]/5 to-[#ea5ec1]/10">
                        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-canvas border border-hairline-soft text-steel shadow-sm">
                          <BoxIcon className="h-6 w-6 text-[#ff5530]" />
                        </div>
                      </div>
                    )}

                    {/* Format Badge */}
                    <div className="absolute top-3 right-3">
                      <span className="rounded-full bg-ink/80 backdrop-blur-md px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-white shadow-sm">
                        {p.codebaseFileName.endsWith(".tar.gz") ? "TAR.GZ" : "ZIP"}
                      </span>
                    </div>
                  </div>

                  {/* Card Content */}
                  <div className="p-6">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-display text-xl font-bold tracking-tight text-ink line-clamp-1">
                        {p.title}
                      </h3>
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => handleDelete(p.id, p.title)}
                          disabled={deletingId === p.id}
                          title="Delete Project"
                          className="text-stone hover:text-red-600 transition-colors p-1 -mr-1 rounded-lg hover:bg-red-50"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    <p className="mt-2 text-sm text-steel line-clamp-3 leading-relaxed whitespace-pre-wrap">
                      {p.description}
                    </p>

                    {/* File Info Pill */}
                    <div className="mt-4 flex items-center gap-2 rounded-xl bg-fog p-2.5 border border-hairline-soft">
                      <FolderIcon className="h-4 w-4 shrink-0 text-steel" />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">
                        {p.codebaseFileName}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] font-medium text-stone">
                        {p.codebaseFileSize}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Card Footer & Download */}
                <div className="border-t border-hairline-soft p-5 bg-fog/40 flex flex-col gap-3">
                  <a
                    href={`/api/drive/download?id=${encodeURIComponent(p.codebaseDriveId)}`}
                    download
                    className="press flex items-center justify-center gap-2 w-full rounded-2xl bg-ink py-2.5 px-4 text-xs font-semibold text-white shadow-sm hover:bg-charcoal transition-colors"
                  >
                    <BoxIcon className="h-4 w-4" />
                    Download Codebase ({p.codebaseFileSize})
                  </a>

                  {/* Author meta */}
                  <div className="flex items-center justify-between text-xs text-stone pt-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ink font-display text-[10px] font-bold text-white">
                        {(p.userEmail[0] ?? "?").toUpperCase()}
                      </span>
                      <span className="truncate text-steel font-medium text-[11px]">
                        {p.userEmail}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] uppercase tracking-wider shrink-0 text-stone">
                      {new Date(p.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Publish Project Modal ── */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-3xl border border-hairline bg-canvas p-6 sm:p-8 shadow-2xl animate-scale-up">
            <div className="flex items-center justify-between pb-4 border-b border-hairline-soft">
              <div>
                <h2 className="font-display text-2xl font-bold tracking-tight text-ink">
                  Publish New Project
                </h2>
                <p className="mt-1 text-xs text-steel">
                  Upload package archive and metadata to your Google Drive backend.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseModal}
                disabled={submitting}
                className="grid h-8 w-8 place-items-center rounded-full hover:bg-fog text-steel hover:text-ink transition-colors"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-700">
                {formError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-5">
              {/* Title */}
              <div>
                <label className="block font-mono text-xs uppercase tracking-wider text-steel mb-1.5 font-semibold">
                  Project Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Vaayu Core Client v1.0"
                  maxLength={100}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-2xl border border-hairline bg-canvas px-4 py-2.5 text-sm text-ink placeholder:text-stone focus:border-ink focus:outline-none transition-colors"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block font-mono text-xs uppercase tracking-wider text-steel mb-1.5 font-semibold">
                  Description *
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="Summarize the codebase contents, key features, and instructions..."
                  maxLength={1000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full rounded-2xl border border-hairline bg-canvas px-4 py-2.5 text-sm text-ink placeholder:text-stone focus:border-ink focus:outline-none transition-colors resize-y"
                />
              </div>

              {/* Codebase File (.zip / .tar.gz) */}
              <div>
                <label className="block font-mono text-xs uppercase tracking-wider text-steel mb-1.5 font-semibold">
                  Codebase Archive (.zip, .tar.gz — max 50MB) *
                </label>
                <div className="rounded-2xl border-2 border-dashed border-hairline hover:border-ink/60 bg-fog/50 p-4 transition-colors">
                  <input
                    ref={codebaseInputRef}
                    type="file"
                    required
                    accept=".zip,.tar.gz,application/zip,application/x-zip-compressed,application/gzip,application/x-gzip,application/x-tar"
                    onChange={handleCodebaseChange}
                    className="block w-full text-xs text-steel file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-ink file:text-white hover:file:bg-charcoal cursor-pointer"
                  />
                  {codebaseFile && (
                    <p className="mt-2 text-xs font-mono text-ink">
                      Selected: <strong>{codebaseFile.name}</strong> (
                      {(codebaseFile.size / (1024 * 1024)).toFixed(2)} MB)
                    </p>
                  )}
                </div>
              </div>

              {/* Preview Image */}
              <div>
                <label className="block font-mono text-xs uppercase tracking-wider text-steel mb-1.5 font-semibold">
                  Preview Image (optional — .png, .jpg, .webp up to 10MB)
                </label>
                <div className="rounded-2xl border-2 border-dashed border-hairline hover:border-ink/60 bg-fog/50 p-4 transition-colors">
                  <input
                    ref={previewInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={handlePreviewChange}
                    className="block w-full text-xs text-steel file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-fog file:text-ink hover:file:bg-hairline cursor-pointer"
                  />
                  {previewUrl && (
                    <div className="mt-3 relative aspect-video w-36 overflow-hidden rounded-xl border border-hairline shadow-sm">
                      <img
                        src={previewUrl}
                        alt="Preview"
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setPreviewFile(null);
                          if (previewUrl) URL.revokeObjectURL(previewUrl);
                          setPreviewUrl(null);
                          if (previewInputRef.current) previewInputRef.current.value = "";
                        }}
                        className="absolute top-1 right-1 h-5 w-5 rounded-full bg-ink/80 text-white text-[10px] flex items-center justify-center hover:bg-ink"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="pt-3 border-t border-hairline-soft flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  disabled={submitting}
                  className="rounded-full border border-hairline px-5 py-2.5 text-xs font-semibold text-steel hover:text-ink hover:bg-fog transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="press inline-flex items-center gap-2 rounded-full bg-ink px-6 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-charcoal disabled:opacity-50 transition-colors"
                >
                  {submitting ? (
                    <>
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Uploading to Google Drive...
                    </>
                  ) : (
                    <>
                      <CheckIcon className="h-4 w-4" />
                      Publish to Drive
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Image Lightbox Modal ── */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4 backdrop-blur-md animate-fade-in cursor-zoom-out"
          onClick={() => setLightboxImage(null)}
        >
          <div
            className="relative max-h-[90vh] max-w-4xl overflow-hidden rounded-3xl border border-white/20 bg-ink shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 bg-black/40 text-white">
              <p className="font-display font-bold text-sm truncate">
                {lightboxImage.title}
              </p>
              <button
                type="button"
                onClick={() => setLightboxImage(null)}
                className="grid h-7 w-7 place-items-center rounded-full bg-white/20 hover:bg-white/30 text-white text-xs"
              >
                ✕
              </button>
            </div>
            <img
              src={lightboxImage.url}
              alt={lightboxImage.title}
              className="max-h-[80vh] w-auto object-contain mx-auto"
            />
          </div>
        </div>
      )}
    </div>
  );
}
