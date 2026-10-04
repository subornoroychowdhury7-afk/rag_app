"use client";

import { useRef, useState } from "react";
import { uploadPdf } from "@/lib/api";
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

export default function Sidebar({ docs, onUploaded }: { docs: Doc[]; onUploaded: (d: Doc) => void }) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
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
      if (inputRef.current) inputRef.current.value = ""; // allow re-selecting the same file
    }
  }

  return (
    <aside className="flex w-full shrink-0 flex-col gap-5 border-b border-slate-200 bg-white p-5 md:w-80 md:border-r md:border-b-0">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-slate-900">Document Q&amp;A</h1>
        <p className="mt-1 text-sm text-slate-500">Answers come only from the PDFs you upload.</p>
      </div>

      <label
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors focus-within:ring-2 focus-within:ring-[#1f3a5f] ${
          dragging ? "border-[#1f3a5f] bg-slate-50" : "border-slate-300 hover:border-slate-400"
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
        {busy ? <Spinner className="h-6 w-6 text-[#1f3a5f]" /> : (
          <svg className="h-6 w-6 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M12 16V4m0 0L7 9m5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        <span className="text-sm font-medium text-slate-700">{busy ? "Processing…" : "Drop a PDF or click to browse"}</span>
        <span className="text-xs text-slate-500">Text-based PDFs only</span>
      </label>

      <div aria-live="polite" className="text-sm">
        {status.kind === "uploading" && (
          <p className="flex items-center gap-2 text-slate-600">
            <Spinner /> Reading and embedding <span className="truncate font-medium">{status.name}</span>
          </p>
        )}
        {status.kind === "success" && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">
            <span className="font-medium">{status.name}</span> is ready ({status.chunks} chunks indexed).
          </p>
        )}
        {status.kind === "error" && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-red-800">{status.message}</p>
        )}
      </div>

      {docs.length > 0 && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <h2 className="mb-2 text-sm font-medium text-slate-700">Uploaded this session</h2>
          <ul className="space-y-1.5">
            {docs.map((d, i) => (
              <li key={`${d.name}-${i}`} className="flex items-baseline justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span className="truncate text-slate-800" title={d.name}>{d.name}</span>
                <span className="shrink-0 text-xs text-slate-500">{d.chunks} chunks</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
