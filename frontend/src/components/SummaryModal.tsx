"use client";

import { useEffect, useState } from "react";
import MarkdownRenderer from "./MarkdownRenderer";
import Spinner from "./Spinner";
import { summarizeDocument, type DocumentSummaryResult } from "@/lib/api";

interface SummaryModalProps {
  filename: string | null;
  onClose: () => void;
  onAskAboutDoc?: (filename: string, question?: string) => void;
}

export default function SummaryModal({
  filename,
  onClose,
  onAskAboutDoc,
}: SummaryModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summaryData, setSummaryData] = useState<DocumentSummaryResult | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!filename) {
      setSummaryData(null);
      setError(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    summarizeDocument(filename)
      .then((res) => {
        if (isMounted) {
          setSummaryData(res);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(
            err instanceof Error ? err.message : "Failed to generate document summary."
          );
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [filename]);

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!filename) return null;

  function copyToClipboard() {
    if (!summaryData?.summary) return;
    navigator.clipboard.writeText(summaryData.summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function downloadMarkdown() {
    if (!summaryData?.summary) return;
    const blob = new Blob([summaryData.summary], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}_Executive_Summary.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 md:p-10">
      {/* Frosted Glass Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-md transition-opacity animate-fade-in"
        onClick={onClose}
      />

      {/* Modal Dialog Card */}
      <div className="relative flex max-h-[88vh] w-full max-w-3xl flex-col rounded-2xl border border-slate-200/80 bg-white/95 shadow-2xl backdrop-blur-xl dark:border-slate-700/80 dark:bg-slate-900/95 transition-all animate-fade-in-up">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200/80 px-6 py-4 dark:border-slate-700/80">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/20">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                  AI Executive Briefing
                </span>
                {summaryData?.total_chunks && (
                  <span className="text-xs text-slate-400">
                    · {summaryData.total_chunks} indexed passages
                  </span>
                )}
              </div>
              <h2
                className="truncate text-base font-semibold text-slate-900 dark:text-slate-100 sm:text-lg"
                title={filename}
              >
                {filename}
              </h2>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="Close modal"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 text-slate-700 dark:text-slate-200">
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="relative flex items-center justify-center">
                <div className="absolute h-16 w-16 animate-ping rounded-full bg-indigo-500/20" />
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 shadow-inner dark:bg-indigo-950/50">
                  <Spinner className="h-7 w-7 text-indigo-600 dark:text-indigo-400" />
                </div>
              </div>
              <h3 className="mt-5 text-base font-semibold text-slate-800 dark:text-slate-100">
                Synthesizing Executive Summary
              </h3>
              <p className="mt-1.5 max-w-md text-xs text-slate-500 dark:text-slate-400">
                Gemini is analyzing document sections, extracting critical data points, and structuring strategic takeaways…
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-center dark:border-red-900/60 dark:bg-red-950/40">
              <p className="text-sm font-medium text-red-800 dark:text-red-300">
                {error}
              </p>
              <button
                onClick={() => {
                  setLoading(true);
                  setError(null);
                  summarizeDocument(filename)
                    .then(setSummaryData)
                    .catch((err) => setError(err.message))
                    .finally(() => setLoading(false));
                }}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700"
              >
                Retry
              </button>
            </div>
          )}

          {!loading && !error && summaryData && (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4 dark:border-slate-800/80 dark:bg-slate-800/40">
                <MarkdownRenderer content={summaryData.summary} />
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        {!loading && !error && summaryData && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 bg-slate-50/70 px-6 py-3.5 dark:border-slate-700/80 dark:bg-slate-900/70">
            <div className="flex items-center gap-2">
              <button
                onClick={copyToClipboard}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                {copied ? (
                  <>
                    <svg className="h-3.5 w-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <svg className="h-3.5 w-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <span>Copy Summary</span>
                  </>
                )}
              </button>

              <button
                onClick={downloadMarkdown}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                title="Download Markdown summary"
              >
                <svg className="h-3.5 w-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span>Export .md</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              {onAskAboutDoc && (
                <button
                  onClick={() => {
                    onAskAboutDoc(filename);
                    onClose();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-3.5 py-1.5 text-xs font-medium text-white shadow-sm transition hover:shadow-md hover:brightness-110"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                  <span>Ask in Chat</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
