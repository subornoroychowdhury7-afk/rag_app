"use client";

import { useRef, useState } from "react";
import { uploadPdf, deleteDocument } from "@/lib/api";
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
}

export default function Sidebar({ isOpen, onClose, docs, onUploaded, onDeleted }: SidebarProps) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = status.kind === "uploading";

  async function handleFile(file: File | undefined) {
    if (!file || busy) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setStatus({ kind: "error", message: "Only PDF files are supported." });
      return;
    }
    setStatus({ kind: "uploading", name: file.name });
    try {
      const res = await uploadPdf(file);
      onUploaded({ name: res.filename, chunks: res.chunks_processed });
      setStatus({ kind: "success", name: res.filename, chunks: res.chunks_processed });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : "Upload failed." });
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
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : "Delete failed." });
    } finally {
      setDeleting(null);
    }
  }

  return (
    <aside
      className={`absolute inset-y-0 left-0 z-50 flex w-80 shrink-0 transform flex-col gap-5 border-r border-slate-200 bg-white/90 p-5 backdrop-blur-xl transition-transform duration-300 ease-in-out dark:border-slate-700/50 dark:bg-slate-900/90 md:static md:translate-x-0 ${
        isOpen ? "translate-x-0 shadow-2xl md:shadow-none" : "-translate-x-full"
      }`}
    >
      {/* Sidebar header */}
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Documents
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Upload PDFs to query them
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
        className={`flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-all duration-200 focus-within:ring-2 focus-within:ring-indigo-500 ${
          dragging
            ? "border-indigo-500 bg-indigo-50 shadow-inner dark:border-indigo-400 dark:bg-indigo-950/30"
            : "border-slate-300 hover:border-indigo-400 hover:bg-slate-50 dark:border-slate-600 dark:hover:border-indigo-500 dark:hover:bg-slate-800/50"
        } ${busy ? "pointer-events-none opacity-60" : ""}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          disabled={busy}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        {busy ? (
          <Spinner className="h-8 w-8 text-indigo-500" />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-950/50">
            <svg
              className="h-6 w-6 text-indigo-500"
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
            {busy ? "Processing…" : "Drop a PDF or click to browse"}
          </span>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            PDFs up to 20 MB, including scanned pages
          </p>
        </div>
      </label>

      {/* Status messages */}
      <div aria-live="polite" className="text-sm">
        {status.kind === "uploading" && (
          <div className="flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300">
            <Spinner className="h-4 w-4" />
            <span>
              Indexing <span className="truncate font-medium">{status.name}</span>
            </span>
          </div>
        )}
        {status.kind === "success" && (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span>
              <span className="font-medium">{status.name}</span> ready ({status.chunks} chunks)
            </span>
          </div>
        )}
        {status.kind === "error" && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-red-700 dark:bg-red-950/30 dark:text-red-300"
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
              />
            </svg>
            {status.message}
          </div>
        )}
      </div>

      {/* Document list */}
      {docs.length > 0 && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {docs.length} document{docs.length !== 1 ? "s" : ""} indexed
          </h3>
          <ul className="space-y-1.5">
            {docs.map((d, i) => (
              <li
                key={`${d.name}-${i}`}
                className="animate-slide-in-left group flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2.5 transition-colors hover:bg-slate-100 dark:bg-slate-800/50 dark:hover:bg-slate-800"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-950/50">
                    <svg
                      className="h-4 w-4 text-indigo-600 dark:text-indigo-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                      />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200" title={d.name}>
                      {d.name}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{d.chunks} chunks</p>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(d.name)}
                  disabled={deleting === d.name}
                  className="shrink-0 rounded-md p-1 text-slate-400 opacity-0 transition-all hover:bg-red-100 hover:text-red-600 group-hover:opacity-100 disabled:opacity-50 dark:hover:bg-red-950/50 dark:hover:text-red-400"
                  title="Delete document"
                >
                  {deleting === d.name ? (
                    <Spinner className="h-4 w-4" />
                  ) : (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
