// @ts-nocheck
"use client";

import { useEffect } from "react";
import { EditorContent, useEditor, ReactRenderer } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Mention from "@tiptap/extension-mention";
import Placeholder from "@tiptap/extension-placeholder";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import { MentionList, type SuggestionItem } from "./MentionList";
import { getUserColor } from "@/lib/userColor";
import "tippy.js/dist/tippy.css";

interface TiptapEditorProps {
  placeholder?: string;
  initialContentJson?: string | null;
  initialText?: string;
  onSubmit?: (content: { text: string; json: unknown }) => void;
  onChange?: (content: { text: string; json: unknown }) => void;
  autoFocus?: boolean;
  minHeight?: string;
  onEmptySubmit?: () => void;
}

// Simple debounce for search — inject @explore / @general channel shortcuts like screenshot when query matches
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedSearch(query: string): Promise<SuggestionItem[]> {
  return new Promise((resolve) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      const q = query.trim().toLowerCase();
      const channels: SuggestionItem[] = [];
      // Show @explore / @general when empty or prefix matches — exactly like screenshot
      if (!q || "explore".startsWith(q)) {
        channels.push({ type: "project", id: "explore", label: "explore", sublabel: "Browse everything", displayName: "explore" } as SuggestionItem);
      }
      if (!q || "general".startsWith(q)) {
        channels.push({ type: "project", id: "general", label: "general", sublabel: "Notify everyone", displayName: "general" } as SuggestionItem);
      }
      try {
        const res = await fetch(`/api/mentions/search?q=${encodeURIComponent(query)}`, { cache: "no-store" });
        const data = await res.json().catch(() => null);
        if (!res.ok) return resolve(channels);
        const results: SuggestionItem[] = Array.isArray(data?.results) ? data.results : [];
        // Channels first, then server results — mirror screenshot order (@explore on top)
        const merged = [...channels, ...results];
        // Dedupe by type+id keep first
        const seen = new Set<string>();
        const deduped = merged.filter((it) => {
          const k = `${it.type}:${it.id}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        resolve(deduped);
      } catch {
        resolve(channels);
      }
    }, 180);
  });
}

export function TiptapEditor({ placeholder = "Type a message… @ to mention", initialContentJson, initialText, onSubmit, onChange, autoFocus }: TiptapEditorProps) {
  // Parse initial JSON if provided
  const initialContent = (() => {
    if (initialContentJson) {
      try {
        const parsed = JSON.parse(initialContentJson);
        if (parsed && parsed.type === "doc") return parsed;
      } catch {
        // fall back to text
      }
    }
    if (initialText) {
      return {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: initialText }] }],
      };
    }
    return "";
  })();

  // Custom mention with type+email for person color
  const CustomMention = Mention.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        id: { default: null },
        label: { default: null },
        type: { default: null },
        email: { default: null },
      };
    },
  });

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        bulletList: false,
        orderedList: false,
        heading: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
      }),
      Placeholder.configure({ placeholder }),
      CustomMention.configure({
        HTMLAttributes: {
          class: "mention-chip",
        },
        renderHTML: ({ node }) => {
          const type = node.attrs.type || "person";
          let colorClass: string;
          if (type === "person") {
            const stable = (node.attrs.email as string) || (node.attrs.label as string) || "unknown";
            const c = getUserColor(stable);
            // Use inline style for exact hex, but also need bg class — we use style for bg
            return [
              "span",
              {
                class: "mention-chip inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold border-white/20",
                style: `background:${c.hex}20; color:${c.hex}; border-color:${c.hex}30`,
                "data-type": type,
              },
              `@${node.attrs.label || node.attrs.id}`,
            ];
          }
          colorClass =
            type === "project"
              ? "bg-coral/10 text-coral border-coral/20"
              : type === "folder" || type === "file"
                ? "bg-azure/10 text-azure border-azure/20"
                : "bg-teal/10 text-teal border-teal/20";
          return ["span", { class: `mention-chip inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${colorClass}`, "data-type": type }, `@${node.attrs.label || node.attrs.id}`];
        },
        suggestion: {
          char: "@",
          allowSpaces: false,
          items: async ({ query }: { query: string }) => {
            // query is after "@", may be empty (just "@") — we want to show recent
            return debouncedSearch(query);
          },
          render: () => {
            let component: ReactRenderer | null = null;
            let popup: TippyInstance[] | null = null;

            return {
              onStart: (props: { editor: unknown; clientRect: (() => DOMRect | null) | null | undefined; items: SuggestionItem[]; command: (v: unknown) => void }) => {
                component = new ReactRenderer(MentionList, {
                  props: { items: props.items, command: props.command },
                  editor: props.editor as never,
                });

                if (!props.clientRect) return;

                popup = tippy("body", {
                  getReferenceClientRect: props.clientRect as unknown as () => DOMRect,
                  appendTo: () => document.body,
                  content: component.element as HTMLElement,
                  showOnCreate: true,
                  interactive: true,
                  trigger: "manual",
                  placement: "bottom-start",
                  maxWidth: "320px",
                  theme: "vaayu-dark",
                  arrow: false,
                  offset: [0, 8],
                  animation: "fade",
                  duration: [120, 80],
                });
              },
              onUpdate: (props: { clientRect: (() => DOMRect | null) | null | undefined; items: SuggestionItem[]; command: (v: unknown) => void }) => {
                if (component) (component as unknown as { updateProps: (p: unknown) => void }).updateProps({ items: props.items, command: props.command });
                if (popup && popup[0] && props.clientRect) {
                  popup[0].setProps({ getReferenceClientRect: props.clientRect as unknown as () => DOMRect });
                }
              },
              onKeyDown: (props: { event: KeyboardEvent }) => {
                if (props.event.key === "Escape") {
                  popup?.[0]?.hide();
                  return true;
                }
                return false;
              },
              onExit: () => {
                popup?.[0]?.destroy();
                component?.destroy();
              },
            };
          },
        },
      }),
    ],
    content: initialContent,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "tiptap-editor min-h-[44px] w-full rounded-2xl border border-hairline bg-canvas px-4 py-3 text-sm outline-none focus:border-ink prose prose-sm max-w-none",
      },
      handleKeyDown: (view, event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          const text = view.state.doc.textContent.trim();
          if (!text) return true;
          const json = (view.state as unknown as { toJSON: () => unknown }).toJSON();
          const handler = (view as unknown as { _onSubmit?: (c: { text: string; json: unknown }) => void })._onSubmit;
          if (handler) handler({ text, json });
          // Clear editor content after submit
          const tr = view.state.tr.delete(0, view.state.doc.content.size);
          view.dispatch(tr);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      const text = editor.getText();
      const json = editor.getJSON();
      onChange?.({ text, json });
      // Attach for handleKeyDown
      const view = editor.view as unknown as { _onSubmit?: (c: { text: string; json: unknown }) => void };
      view._onSubmit = onSubmit;
    },
    onCreate: ({ editor }) => {
      const view = editor.view as unknown as { _onSubmit?: (c: { text: string; json: unknown }) => void };
      view._onSubmit = onSubmit;
      if (autoFocus) editor.commands.focus();
    },
  });

  // Keep onSubmit updated
  useEffect(() => {
    if (editor) {
      const view = editor.view as unknown as { _onSubmit?: (c: { text: string; json: unknown }) => void };
      view._onSubmit = onSubmit;
    }
  }, [editor, onSubmit]);

  // Handle clearing after submit externally: parent can remount via key, but also we provide clear via effect
  useEffect(() => {
    if (editor && autoFocus) editor.commands.focus();
  }, [editor, autoFocus]);

  // Update content if initial changes (for edit mode)
  useEffect(() => {
    if (editor && initialContentJson) {
      try {
        const parsed = JSON.parse(initialContentJson);
        if (parsed && parsed.type === "doc") {
          // Only set if different to avoid loop
          const current = JSON.stringify(editor.getJSON());
          if (current !== JSON.stringify(parsed)) {
            editor.commands.setContent(parsed);
          }
        }
      } catch {}
    }
  }, [editor, initialContentJson]);

  return (
    <div className="w-full">
      <EditorContent editor={editor} />
      <style jsx global>{`
        .tiptap-editor p {
          margin: 0;
        }
        .tiptap-editor .mention-chip {
          display: inline-flex;
          align-items: center;
          border-radius: 9999px;
          padding: 0.15rem 0.5rem;
          font-size: 0.75rem;
          font-weight: 600;
          border: 1px solid;
          margin: 0 0.15rem;
        }
        .tiptap p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: #8e8e93;
          pointer-events: none;
          height: 0;
        }
        .tippy-box[data-theme~="vaayu-dark"] {
          background: transparent;
          border: 0;
          box-shadow: none;
          padding: 0;
        }
        .tippy-box[data-theme~="vaayu-dark"] .tippy-content {
          padding: 0;
          background: transparent;
        }
        .tippy-box[data-theme~="vaayu-dark"] .tippy-arrow {
          display: none;
        }
      `}</style>
    </div>
  );
}

export function extractPlainTextFromTiptap(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const doc = json as { type?: string; content?: unknown[] };
  if (!Array.isArray(doc.content)) return "";
  let out = "";
  for (const node of doc.content as Array<{ type?: string; content?: Array<{ type?: string; text?: string; attrs?: { label?: string } }> }>) {
    if (node.type === "paragraph" && Array.isArray(node.content)) {
      for (const child of node.content) {
        if (child.type === "text" && typeof child.text === "string") out += child.text;
        else if (child.type === "mention" && child.attrs?.label) out += `@${child.attrs.label}`;
        else if (child.type === "hardBreak") out += "\n";
      }
      out += "\n";
    }
  }
  return out.trim();
}

export function renderTiptapJsonToReact(json: unknown, onMentionClick?: (type: string, id: string) => void): React.ReactNode {
  if (!json || typeof json !== "object") return null;
  const doc = json as { content?: unknown[] };
  if (!Array.isArray(doc.content)) return null;
  return (doc.content as Array<{ type?: string; content?: Array<{ type: string; text?: string; attrs?: { id?: string; label?: string; type?: string; email?: string } }> }>).map((node, i) => {
    if (node.type !== "paragraph" || !Array.isArray(node.content)) return null;
    return (
      <span key={i}>
        {node.content.map((child, j) => {
          if (child.type === "mention" && child.attrs) {
            const label = child.attrs.label || child.attrs.id || "mention";
            const type = child.attrs.type || "person";
            let color = "";
            let style: React.CSSProperties | undefined;
            if (type === "person") {
              const stable = (child.attrs.email as string) || label || "unknown";
              const c = getUserColor(stable);
              style = { background: `${c.hex}15`, color: c.hex, borderColor: `${c.hex}30` };
              color = "border";
            } else if (type === "project") color = "bg-coral/10 text-coral border-coral/20";
            else if (type === "folder" || type === "file") color = "bg-azure/10 text-azure border-azure/20";
            else color = "bg-teal/10 text-teal border-teal/20";
            // Graceful deleted handling: if label is empty or id missing, show unavailable
            const isUnavailable = !child.attrs.id || !label || label === "unknown";
            if (isUnavailable) {
              return (
                <span key={j} className="mx-0.5 inline-flex items-center rounded-full border border-hairline bg-fog px-2 py-0.5 text-xs font-semibold text-steel line-through" title="This item is no longer available">
                  @{label} (unavailable)
                </span>
              );
            }
            return (
              <span
                key={j}
                onClick={() => onMentionClick?.(type, child.attrs!.id!)}
                className={`mx-0.5 inline-flex cursor-pointer items-center rounded-full border px-2 py-0.5 text-xs font-semibold hover:opacity-80 ${color}`}
                style={style}
              >
                @{label}
              </span>
            );
          }
          if (child.type === "text" && child.text) return <span key={j}>{child.text}</span>;
          return null;
        })}
      </span>
    );
  });
}
