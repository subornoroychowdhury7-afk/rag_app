"use client";

import { useRef, useState } from "react";
import { uploadFile, deleteDocument } from "@/lib/api";
import Spinner from "./Spinner";

export interface Doc {
  name: string;
  chunks: number;
}

type Status =
  | { kind: "idle" }
  | { kind: "uploading"; name: string }
  | { kind: "success"; name: string; chunks: number }
  | { kind: "error"; message: string };

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  docs: Doc[];
  onUploaded: (d: Doc) => void;
  onDeleted: (name: string) => void;
  onSummarize?: (name: string) => void;
  selectedDocFilter?: string | null;
  onSelectDocFilter?: (name: string | null) => void;
}

export default function Sidebar({
  isOpen,
  onClose,
  docs,
  onUploaded,
  onDeleted,
  onSummarize,
  selectedDocFilter,
  onSelectDocFilter,
}: SidebarProps) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = status.kind === "uploading";

  async function handleFile(file: File | undefined) {
    if (!file || busy) return;
    const lower = file.name.toLowerCase();
    const valid = [".pdf", ".txt", ".md", ".markdown"].some((ext) =>
      lower.endsWith(ext)
    );
    if (!valid) {
      setStatus({
        kind: "error",
        message: "Supported formats: PDF, TXT, and Markdown (.md).",
      });
      return;
    }
    setStatus({ kind: "uploading", name: file.name });
    try {
      const res = await uploadFile(file);
      onUploaded({ name: res.filename, chunks: res.chunks_processed });
      setStatus({ kind: "success", name: res.filename, chunks: res.chunks_processed });
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Upload failed.",
      });
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleDelete(name: string) {
    if (deleting) return;
    setDeleting(name);
    try {
      await deleteDocument(name);
      onDeleted(name);
      if (selectedDocFilter === name && onSelectDocFilter) {
        onSelectDocFilter(null);
      }
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Delete failed.",
      });
    } finally {
      setDeleting(null);
    }
  }

  return (
    <aside
      className={`absolute inset-y-0 left-0 z-50 flex w-80 shrink-0 transform flex-col gap-5 border-r border-slate-200 bg-white/95 p-5 backdrop-blur-xl transition-transform duration-300 ease-in-out dark:border-slate-700/50 dark:bg-slate-900/95 md:static md:translate-x-0 ${
        isOpen ? "translate-x-0 shadow-2xl md:shadow-none" : "-translate-x-full"
      }`}
    >
      {/* Sidebar header */}
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Knowledge Base
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Upload documents to ground your AI
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300 md:hidden"
            aria-label="Close sidebar"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Upload area */}
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFile(e.dataTransfer.files[0]);
        }}
        className={`flex cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-7 text-center transition-all duration-200 focus-within:ring-2 focus-within:ring-indigo-500 ${
          dragging
            ? "border-indigo-500 bg-indigo-50 shadow-inner dark:border-indigo-400 dark:bg-indigo-950/30"
            : "border-slate-300 hover:border-indigo-400 hover:bg-slate-50 dark:border-slate-600 dark:hover:border-indigo-500 dark:hover:bg-slate-800/50"
        } ${busy ? "pointer-events-none opacity-60" : ""}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.txt,.md,.markdown,text/plain,text/markdown,application/pdf"
          className="sr-only"
          disabled={busy}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        {busy ? (
          <Spinner className="h-8 w-8 text-indigo-500" />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-50 to-indigo-100 shadow-sm dark:from-indigo-950/60 dark:to-indigo-900/40">
            <svg
              className="h-6 w-6 text-indigo-600 dark:text-indigo-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path
                d="M12 16V4m0 0L7 9m5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        )}
        <div>
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {busy ? "Processing document…" : "Drop files or click to browse"}
          </span>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            PDF, TXT, or Markdown up to 20 MB
          </p>
        </div>
      </label>

      {/* Status messages */}
      <div aria-live="polite" className="text-sm">
        {status.kind === "uploading" && (
          <div className="flex items-center gap-2 rounded-xl bg-indigo-50 px-3 py-2 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300">
            <Spinner className="h-4 w-4" />
            <span className="truncate">
              Indexing <span className="font-medium">{status.name}</span>
            </span>
          </div>
        )}
        {status.kind === "success" && (
          <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span className="truncate">
              <span className="font-medium">{status.name}</span> ready ({status.chunks} chunks)
            </span>
          </div>
        )}
        {status.kind === "error" && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-red-700 dark:bg-red-950/30 dark:text-red-300"
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
              />
            </svg>
            <span className="truncate">{status.message}</span>
          </div>
        )}
      </div>

      {/* Document list */}
      {docs.length > 0 && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {docs.length} document{docs.length !== 1 ? "s" : ""} indexed
            </h3>
            {selectedDocFilter && onSelectDocFilter && (
              <button
                onClick={() => onSelectDocFilter(null)}
                className="text-[11px] font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                Clear filter
              </button>
            )}
          </div>

          <ul className="space-y-2">
            {docs.map((d, i) => {
              const isSelected = selectedDocFilter === d.name;
              const isPdf = d.name.toLowerCase().endsWith(".pdf");
              return (
                <li
                  key={`${d.name}-${i}`}
                  onClick={() => {
                    if (onSelectDocFilter) {
                      onSelectDocFilter(isSelected ? null : d.name);
                    }
                  }}
                  className={`animate-slide-in-left group relative flex cursor-pointer items-center justify-between gap-2 rounded-xl border p-2.5 transition-all ${
                    isSelected
                      ? "border-indigo-500/80 bg-indigo-50/70 shadow-sm dark:border-indigo-500 dark:bg-indigo-950/40"
                      : "border-slate-200/80 bg-slate-50 hover:border-slate-300 hover:bg-slate-100/80 dark:border-slate-800 dark:bg-slate-800/40 dark:hover:bg-slate-800"
                  }`}
                  title={`Click to filter chat to ${d.name}`}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold ${
                        isPdf
                          ? "bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400"
                          : "bg-indigo-100 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400"
                      }`}
                    >
                      {isPdf ? "PDF" : "DOC"}
                    </div>
                    <div className="min-w-0">
                      <p
                        className={`truncate text-xs font-semibold ${
                          isSelected
                            ? "text-indigo-900 dark:text-indigo-200"
                            : "text-slate-800 dark:text-slate-200"
                        }`}
                        title={d.name}
                      >
                        {d.name}
                      </p>
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                        <span>{d.chunks} chunks</span>
                        {isSelected && (
                          <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                            · Active scope
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {onSummarize && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSummarize(d.name);
                        }}
                        className="flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-[11px] font-semibold text-indigo-600 shadow-sm transition hover:bg-indigo-50 dark:bg-slate-800 dark:text-indigo-400 dark:hover:bg-slate-700"
                        title="AI Executive Summary"
                      >
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        <span>Summary</span>
                      </button>
                    )}

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(d.name);
                      }}
                      disabled={deleting === d.name}
                      className="rounded-lg p-1.5 text-slate-400 opacity-60 transition-all hover:bg-red-50 hover:text-red-600 hover:opacity-100 disabled:opacity-40 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                      title="Delete document"
                    >
                      {deleting === d.name ? (
                        <Spinner className="h-3.5 w-3.5" />
                      ) : (
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      )}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </aside>
  );
}
