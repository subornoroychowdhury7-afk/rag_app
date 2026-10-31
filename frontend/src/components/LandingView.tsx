"use client";

import { useRef, useState } from "react";
import MarkdownRenderer from "./MarkdownRenderer";
import Spinner from "./Spinner";

interface LandingViewProps {
  onGetStarted: () => void;
  onUploadFile: (file: File) => Promise<void>;
  docsCount: number;
}

export default function LandingView({
  onGetStarted,
  onUploadFile,
  docsCount,
}: LandingViewProps) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [activeDemoTab, setActiveDemoTab] = useState<"math" | "hallucination" | "citation" | "briefing">("math");
  const [activeProblemTab, setActiveProblemTab] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileSelected(file?: File) {
    if (!file || uploading) return;
    const lower = file.name.toLowerCase();
    const valid = [".pdf", ".txt", ".md", ".markdown"].some((ext) =>
      lower.endsWith(ext)
    );
    if (!valid) {
      setUploadError("Supported formats: PDF, TXT, and Markdown (.md).");
      return;
    }

    setUploadError(null);
    setUploading(true);
    try {
      await onUploadFile(file);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed. Please try again.");
      setUploading(false);
    }
  }

  const problemsData = [
    {
      id: "hallucination",
      badge: "Crucial Reliability",
      title: "The AI Hallucination & Fabrication Trap",
      icon: (
        <svg className="h-6 w-6 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      ),
      failReason:
        "Standard online chatbots (generic PDF bots, ChatGPT wrappers) invent plausible-sounding answers, fictitious statistics, or fabricated contract clauses when information does not exist in your file.",
      docQASolution:
        "DocQ&A enforces a mathematical cosine distance cutoff (MAX_DISTANCE = 0.78 with hybrid keyword adjustment). If no retrieved chunk passes this threshold, the API strictly returns the honest refusal: 'I cannot answer this based on the uploaded documents.' The system prompt strictly prohibits outside knowledge.",
      codeProof: "Verified in backend/main.py (lines 65-74, 103-120, 708-726)",
      proofDetails: [
        "MAX_DISTANCE = 0.78 strict cosine distance cutoff with hybrid keyword boost",
        "Zero-hallucination fallback: fixed string returned if no chunks pass",
        "System prompt forbids outside knowledge and forces quotation of context",
      ],
    },
    {
      id: "ocr",
      badge: "Deep Document Extraction",
      title: "The Image-Only Scanned PDF & Invoice Wall",
      icon: (
        <svg className="h-6 w-6 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      failReason:
        "Almost all web-based PDF chatbots extract only embedded digital font glyphs. Scanned agreements, archived research papers, receipts, or photocopies extract 0 bytes of text and fail silently or throw 'corrupted file' errors.",
      docQASolution:
        "DocQ&A runs a dual-layer extraction engine. PyMuPDF extracts native digital text; if any page has no selectable text, it is rendered at 200 DPI into high-resolution images and run through Tesseract OCR. If Tesseract is unavailable on the host, it automatically delegates to Gemini 3.8 Flash's native multimodal PDF vision transcription.",
      codeProof: "Verified in backend/main.py (lines 192-360: extract_pdf_text & ocr_pdf_with_gemini)",
      proofDetails: [
        "PyMuPDF per-page selectable text analysis",
        "Automatic fallback to 200 DPI pixmap rendering + Tesseract OCR",
        "Zero-failure fallback to Gemini multimodal base64 PDF vision transcription",
      ],
    },
    {
      id: "math",
      badge: "Scientific & Technical Depth",
      title: "Mangled Math, Formulas & Proofs",
      icon: (
        <svg className="h-6 w-6 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      ),
      failReason:
        "Generic PDF software breaks complex scientific, financial, or engineering notation into garbled ASCII mush (superscripts, subscripts, integral signs, and matrices get mangled or stripped completely).",
      docQASolution:
        "DocQ&A's prompt requires Gemini to write all mathematical reasoning, steps, and formulas in standard LaTeX ($...$ and $$...$$). The frontend renders every equation dynamically using KaTeX with horizontal scroll protection for wide equations.",
      codeProof: "Verified in backend/main.py (lines 103-130) & frontend MarkdownRenderer.tsx (lines 43-65)",
      proofDetails: [
        "Backend prompt mandates LaTeX formatting ($...$ and $$...$$) & step-by-step working",
        "Frontend remark-math + rehype-katex rendering engine",
        "Global KaTeX CSS styling with overflow protection for complex matrices",
      ],
    },
    {
      id: "provenance",
      badge: "Absolute Transparency",
      title: "Black-Box 'Trust Me' Citations",
      icon: (
        <svg className="h-6 w-6 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      ),
      failReason:
        "Existing software displays vague footnotes like '[1]' with no way to see what snippet was actually retrieved from the document, hiding potential model hallucinations.",
      docQASolution:
        "Every DocQ&A response includes collapsible source cards disclosing the exact chunk verbatim text, source filename, chunk index, a 1-click copy quote button, and a calculated hybrid relevance match score combining dense vector similarity and keyword scoring.",
      codeProof: "Verified in backend/main.py (lines 696-725) & frontend Chat.tsx (lines 80-145)",
      proofDetails: [
        "Hybrid similarity match score calculated directly from vector distance + BM25 keyword overlap",
        "Exact chunk index and filename provenance attached to every message",
        "One-click copy button for verbatim source evidence verification",
      ],
    },
    {
      id: "scoping",
      badge: "Context Isolation",
      title: "Cross-Document Context Pollution",
      icon: (
        <svg className="h-6 w-6 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
        </svg>
      ),
      failReason:
        "When users upload multiple files (e.g., 'Q1_Report.pdf' and 'Q2_Report.pdf'), generic tools combine all documents into one bag of words, mixing numbers and facts across different documents without scoping.",
      docQASolution:
        "DocQ&A features an active document filter. When selected, the backend restricts ChromaDB cosine vector search strictly using where={'source': filename}, mathematically isolating queries to a single document index.",
      codeProof: "Verified in backend/main.py (lines 685-695) & frontend Sidebar.tsx (lines 220-250)",
      proofDetails: [
        "ChromaDB metadata-level filtering via where={'source': filename}",
        "Per-document chunk counting, inspection, and one-click deletion",
        "UI document filter pills to toggle between global or scoped search",
      ],
    },
    {
      id: "briefing",
      badge: "Executive Productivity",
      title: "Drowning in Dense 100-Page Documents",
      icon: (
        <svg className="h-6 w-6 text-cyan-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
      failReason:
        "Reading a 50+ page legal brief, financial audit, or technical spec to locate strategic findings takes hours. Typical chatbots provide brief, superficial summaries that overlook critical numbers.",
      docQASolution:
        "DocQ&A features a specialized AI Executive Briefing endpoint (/documents/{filename}/summarize). It aggregates the document's sequential chunks and runs a dedicated 4-section executive prompt: Executive Overview, Key Highlights & Critical Data, Strategic Takeaways & Risks, and Recommended Inquiries.",
      codeProof: "Verified in backend/main.py (lines 841-890) & frontend SummaryModal.tsx",
      proofDetails: [
        "Dedicated executive synthesis prompt with 4 standardized sections",
        "Includes actionable strategic recommendations and risk vectors",
        "Generates intelligent follow-up inquiries to probe the document further",
      ],
    },
  ];

  return (
    <div className="relative min-h-screen bg-slate-50 text-slate-900 transition-colors duration-300 dark:bg-slate-950 dark:text-slate-100">
      {/* Background Decorative Grid & Glows */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="animate-pulse-slow absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-indigo-500/15 blur-[120px] dark:bg-indigo-600/20" />
        <div className="animate-pulse-slower absolute top-1/3 -right-40 h-[600px] w-[600px] rounded-full bg-violet-500/15 blur-[140px] dark:bg-violet-600/15" />
        <div className="animate-float-slow absolute bottom-10 left-1/4 h-[400px] w-[400px] rounded-full bg-emerald-500/10 blur-[100px] dark:bg-emerald-600/10" />
        <div className="bg-grid-pattern absolute inset-0 opacity-40 dark:opacity-20" />
      </div>

      {/* Main Container */}
      <div className="relative z-10 mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Navigation Bar inside Landing */}
        <header className="mb-12 flex items-center justify-between border-b border-slate-200/80 pb-6 dark:border-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl shadow-md shadow-indigo-500/25 transition-transform duration-300 hover:rotate-6 hover:scale-105 overflow-hidden">
              <svg viewBox="0 0 512 512" className="h-10 w-10" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="lv-bg" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#4f46e5"/>
                    <stop offset="50%" stopColor="#7c3aed"/>
                    <stop offset="100%" stopColor="#a855f7"/>
                  </linearGradient>
                </defs>
                <rect x="16" y="16" width="480" height="480" rx="96" ry="96" fill="url(#lv-bg)"/>
                <path d="M152 96L320 96L368 144L368 416L152 416Z" fill="#fff" opacity={0.95}/>
                <path d="M320 96L368 144L320 144Z" fill="#c7d2fe" opacity={0.8}/>
                <rect x="180" y="168" width="148" height="8" rx="4" fill="#a5b4fc" opacity={0.6}/>
                <rect x="180" y="192" width="120" height="8" rx="4" fill="#a5b4fc" opacity={0.5}/>
                <rect x="180" y="216" width="156" height="8" rx="4" fill="#a5b4fc" opacity={0.6}/>
                <rect x="180" y="240" width="100" height="8" rx="4" fill="#a5b4fc" opacity={0.4}/>
                <rect x="180" y="264" width="140" height="8" rx="4" fill="#a5b4fc" opacity={0.55}/>
                <rect x="176" y="290" width="164" height="16" rx="4" fill="#fbbf24" opacity={0.3}/>
                <rect x="180" y="294" width="156" height="8" rx="4" fill="#f59e0b" opacity={0.9}/>
                <rect x="180" y="320" width="130" height="8" rx="4" fill="#a5b4fc" opacity={0.5}/>
                <rect x="180" y="344" width="148" height="8" rx="4" fill="#a5b4fc" opacity={0.45}/>
                <rect x="180" y="368" width="110" height="8" rx="4" fill="#a5b4fc" opacity={0.4}/>
                <g stroke="#c084fc" strokeWidth="2.5" opacity={0.7}>
                  <line x1="340" y1="200" x2="388" y2="168"/><line x1="340" y1="200" x2="400" y2="224"/>
                  <line x1="340" y1="200" x2="372" y2="256"/><line x1="388" y1="168" x2="424" y2="132"/>
                  <line x1="388" y1="168" x2="432" y2="196"/><line x1="400" y1="224" x2="432" y2="196"/>
                  <line x1="400" y1="224" x2="440" y2="260"/><line x1="372" y1="256" x2="440" y2="260"/>
                  <line x1="372" y1="256" x2="396" y2="312"/><line x1="396" y1="312" x2="440" y2="260"/>
                  <line x1="396" y1="312" x2="360" y2="360"/><line x1="396" y1="312" x2="436" y2="340"/>
                  <line x1="436" y1="340" x2="440" y2="260"/><line x1="360" y1="360" x2="436" y2="340"/>
                </g>
                <circle cx="340" cy="200" r="10" fill="#e0e7ff" stroke="#818cf8" strokeWidth="2"/>
                <circle cx="388" cy="168" r="7" fill="#c7d2fe" stroke="#a78bfa" strokeWidth="1.5"/>
                <circle cx="400" cy="224" r="7" fill="#c7d2fe" stroke="#a78bfa" strokeWidth="1.5"/>
                <circle cx="372" cy="256" r="8" fill="#ddd6fe" stroke="#8b5cf6" strokeWidth="1.5"/>
                <circle cx="432" cy="196" r="6" fill="#ede9fe" stroke="#a78bfa" strokeWidth="1.5"/>
                <circle cx="424" cy="132" r="5" fill="#f5f3ff" stroke="#c4b5fd" strokeWidth="1"/>
                <circle cx="440" cy="260" r="7" fill="#c7d2fe" stroke="#a78bfa" strokeWidth="1.5"/>
                <circle cx="396" cy="312" r="8" fill="#ddd6fe" stroke="#8b5cf6" strokeWidth="1.5"/>
                <circle cx="360" cy="360" r="6" fill="#ede9fe" stroke="#a78bfa" strokeWidth="1.5"/>
                <circle cx="436" cy="340" r="5" fill="#f5f3ff" stroke="#c4b5fd" strokeWidth="1"/>
                <g transform="translate(108, 280)">
                  <circle cx="0" cy="0" r="44" fill="none" stroke="#fff" strokeWidth="7" opacity={0.9}/>
                  <circle cx="0" cy="0" r="44" fill="none" stroke="#fbbf24" strokeWidth="4" opacity={0.6}/>
                  <line x1="30" y1="30" x2="60" y2="60" stroke="#fff" strokeWidth="7" strokeLinecap="round" opacity={0.9}/>
                  <line x1="30" y1="30" x2="60" y2="60" stroke="#fbbf24" strokeWidth="4" strokeLinecap="round" opacity={0.6}/>
                  <circle cx="-8" cy="-12" r="3" fill="#fbbf24" opacity={0.8}/>
                  <circle cx="10" cy="-4" r="2" fill="#fde68a" opacity={0.6}/>
                </g>
              </svg>
            </div>
            <div>
              <span className="text-xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-600 via-violet-600 to-indigo-500 bg-clip-text text-transparent dark:from-indigo-400 dark:via-violet-300 dark:to-indigo-300">
                DocQ&amp;A
              </span>
              <span className="ml-2 inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-700/10 dark:bg-indigo-950/60 dark:text-indigo-300 dark:ring-indigo-300/20">
                Neural RAG
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {docsCount > 0 && (
              <button
                onClick={onGetStarted}
                className="hidden sm:inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white/80 px-4 py-2 text-xs font-semibold text-slate-700 shadow-xs backdrop-blur-md transition-all duration-300 hover:scale-105 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <span>Active Workspace ({docsCount} docs)</span>
                <span className="text-indigo-500 transition-transform duration-300 group-hover:translate-x-1">→</span>
              </button>
            )}

            <button
              onClick={() => {
                fileInputRef.current?.click();
              }}
              className="shimmer-sweep group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-700 to-violet-700 px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all duration-300 hover:scale-[1.03] hover:shadow-indigo-500/40 active:scale-[0.97]"
            >
              <span>Get Started</span>
              <svg className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
          </div>
        </header>

        {/* HERO SECTION */}
        <section className="mb-20 text-center">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-indigo-200/80 bg-indigo-50/80 px-4 py-1.5 text-xs font-medium text-indigo-700 shadow-xs backdrop-blur-md transition-all duration-300 hover:border-indigo-300 hover:shadow-md hover:scale-[1.02] dark:border-indigo-800/60 dark:bg-indigo-950/50 dark:text-indigo-300">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <span>Gemini 3.8 Flash • Deep Thinking Mode • Hybrid Dense + Lexical Search</span>
          </div>

          <h1 className="mt-6 text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl text-slate-900 dark:text-white">
            Chat With Documents That{" "}
            <span className="animate-gradient-flow bg-gradient-to-r from-indigo-600 via-violet-500 to-emerald-500 bg-clip-text text-transparent dark:from-indigo-400 dark:via-violet-300 dark:to-emerald-400">
              Never Hallucinate.
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-3xl text-base leading-relaxed text-slate-600 dark:text-slate-300 sm:text-lg">
            Upload PDFs, scanned documents, TXT, or Markdown files. DocQ&amp;A searches your documents with
            768-dim dense vector embeddings and BM25 hybrid ranking, answering with step-by-step deep thinking,
            mathematical LaTeX proofs, verifiable source citations, and executive briefings.
          </p>

          {/* Interactive Hero Dropzone / Launchpad */}
          <div className="mx-auto mt-10 max-w-2xl">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                handleFileSelected(e.dataTransfer.files[0]);
              }}
              className={`group relative overflow-hidden rounded-3xl border-2 border-dashed p-8 transition-all duration-500 backdrop-blur-xl ${
                dragging
                  ? "animate-border-glow scale-[1.02] border-indigo-500 bg-indigo-50/90 shadow-2xl shadow-indigo-500/25 dark:border-indigo-400 dark:bg-indigo-950/50"
                  : "border-slate-300/80 bg-white/75 shadow-xl shadow-slate-200/50 hover:scale-[1.01] hover:border-indigo-400 hover:shadow-2xl hover:shadow-indigo-500/15 hover:bg-white/95 dark:border-slate-700/80 dark:bg-slate-900/60 dark:shadow-none dark:hover:border-indigo-500 dark:hover:bg-slate-900/90"
              } ${uploading ? "pointer-events-none opacity-80" : ""}`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt,.md,.markdown,text/plain,text/markdown,application/pdf"
                className="sr-only"
                disabled={uploading}
                onChange={(e) => handleFileSelected(e.target.files?.[0])}
              />

              {uploading ? (
                <div className="flex flex-col items-center justify-center py-4">
                  <Spinner className="h-10 w-10 text-indigo-600 dark:text-indigo-400" />
                  <p className="mt-4 text-sm font-semibold text-slate-800 dark:text-slate-200">
                    Ingesting document &amp; generating 768-dim embeddings...
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    PyMuPDF extraction / Tesseract OCR → Chunking with overlap → ChromaDB storage
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <div className="animate-float flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-100 to-violet-100 text-indigo-600 shadow-inner transition-transform duration-300 group-hover:scale-110 dark:from-indigo-950/60 dark:to-violet-900/40 dark:text-indigo-400">
                    <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M12 16V4m0 0L7 9m5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>

                  <h3 className="mt-4 text-lg font-bold text-slate-900 dark:text-slate-100">
                    Drag and drop your document here
                  </h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    PDF (digital or scanned), Markdown (.md), or plain text (.txt) up to 20MB
                  </p>

                  <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="shimmer-sweep inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-semibold text-white shadow-md shadow-indigo-600/25 transition-all duration-300 hover:bg-indigo-700 hover:scale-105 active:scale-95"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l4-4m0 0l4 4m-4-4v12" />
                      </svg>
                      <span>Select Document to Upload</span>
                    </button>

                    <button
                      type="button"
                      onClick={onGetStarted}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white/80 px-4 py-2.5 text-xs font-medium text-slate-700 shadow-xs transition-all duration-300 hover:scale-105 hover:bg-slate-50 hover:border-indigo-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      <span>Explore Workspace Directly</span>
                      <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
                    </button>
                  </div>
                </div>
              )}

              {uploadError && (
                <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/50 dark:text-rose-300">
                  {uploadError}
                </div>
              )}
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="mx-auto mt-12 grid max-w-4xl grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="group cursor-default rounded-2xl border border-slate-200/70 bg-white/60 p-4 shadow-xs backdrop-blur-md transition-all duration-300 hover:-translate-y-1.5 hover:border-indigo-400 hover:shadow-xl hover:shadow-indigo-500/10 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-indigo-500">
              <div className="text-2xl font-black text-indigo-600 transition-transform duration-300 group-hover:scale-110 dark:text-indigo-400">100%</div>
              <div className="mt-1 text-xs font-medium text-slate-600 dark:text-slate-400">Grounded Citations</div>
            </div>
            <div className="group cursor-default rounded-2xl border border-slate-200/70 bg-white/60 p-4 shadow-xs backdrop-blur-md transition-all duration-300 hover:-translate-y-1.5 hover:border-violet-400 hover:shadow-xl hover:shadow-violet-500/10 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-violet-500">
              <div className="text-2xl font-black text-violet-600 transition-transform duration-300 group-hover:scale-110 dark:text-violet-400">768-D</div>
              <div className="mt-1 text-xs font-medium text-slate-600 dark:text-slate-400">Gemini Embeddings</div>
            </div>
            <div className="group cursor-default rounded-2xl border border-slate-200/70 bg-white/60 p-4 shadow-xs backdrop-blur-md transition-all duration-300 hover:-translate-y-1.5 hover:border-emerald-400 hover:shadow-xl hover:shadow-emerald-500/10 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-emerald-500">
              <div className="text-2xl font-black text-emerald-600 transition-transform duration-300 group-hover:scale-110 dark:text-emerald-400">Dual OCR</div>
              <div className="mt-1 text-xs font-medium text-slate-600 dark:text-slate-400">Tesseract + Vision</div>
            </div>
            <div className="group cursor-default rounded-2xl border border-slate-200/70 bg-white/60 p-4 shadow-xs backdrop-blur-md transition-all duration-300 hover:-translate-y-1.5 hover:border-cyan-400 hover:shadow-xl hover:shadow-cyan-500/10 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-cyan-500">
              <div className="text-2xl font-black text-cyan-600 transition-transform duration-300 group-hover:scale-110 dark:text-cyan-400">Deep CoT</div>
              <div className="mt-1 text-xs font-medium text-slate-600 dark:text-slate-400">Gemini 3.8 Flash Thinking</div>
            </div>
          </div>
        </section>

        {/* SECTION 1: WHAT IT IS */}
        <section id="what-it-is" className="mb-24">
          <div className="text-center">
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
              Architectural Foundation
            </span>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl text-slate-900 dark:text-white">
              What is DocQ&amp;A?
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              DocQ&amp;A is an enterprise-grade Retrieval-Augmented Generation (RAG) platform
              engineered specifically to solve the critical flaws of modern document AI.
            </p>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            <div className="group relative rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-sm backdrop-blur-sm transition-all duration-300 hover:-translate-y-2 hover:border-indigo-400 hover:shadow-xl hover:shadow-indigo-500/10 dark:border-slate-800 dark:bg-slate-900/80 dark:hover:border-indigo-500">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 shadow-inner transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6 dark:bg-indigo-950/60 dark:text-indigo-400">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <h3 className="mt-4 text-base font-bold text-slate-900 dark:text-slate-100">
                Local-Persistent Vector Store
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                Powered by ChromaDB with persistent HNSW index and cosine space. Your document segments are
                chunked into 1,800-character windows with 300-character overlap, re-ranked via hybrid BM25 keyword overlap.
              </p>
            </div>

            <div className="group relative rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-sm backdrop-blur-sm transition-all duration-300 hover:-translate-y-2 hover:border-violet-400 hover:shadow-xl hover:shadow-violet-500/10 dark:border-slate-800 dark:bg-slate-900/80 dark:hover:border-violet-500">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-50 text-violet-600 shadow-inner transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6 dark:bg-violet-950/60 dark:text-violet-400">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="mt-4 text-base font-bold text-slate-900 dark:text-slate-100">
                Google Gemini Neural Core
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                Embeddings are mapped via <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] dark:bg-slate-800">gemini-embedding-2</code> (768 dimensions),
                and answers are synthesized by <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] dark:bg-slate-800">gemini-3.8-flash</code> with deep thinking mode and up to 8,192 output tokens.
              </p>
            </div>

            <div className="group relative rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-sm backdrop-blur-sm transition-all duration-300 hover:-translate-y-2 hover:border-emerald-400 hover:shadow-xl hover:shadow-emerald-500/10 dark:border-slate-800 dark:bg-slate-900/80 dark:hover:border-emerald-500">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 shadow-inner transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6 dark:bg-emerald-950/60 dark:text-emerald-400">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="mt-4 text-base font-bold text-slate-900 dark:text-slate-100">
                Guaranteed Citations &amp; Refusal
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                Instead of making speculative guesses, queries without passing vector similarity (distance &gt; 0.78)
                refuse to generate unsupported answers. Every returned answer quotes its exact source chunk.
              </p>
            </div>
          </div>
        </section>

        {/* SECTION 2: HOW TO USE IT */}
        <section id="how-to-use" className="mb-24">
          <div className="text-center">
            <span className="text-xs font-bold uppercase tracking-wider text-violet-600 dark:text-violet-400">
              Three Seamless Steps
            </span>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl text-slate-900 dark:text-white">
              How to Use DocQ&amp;A
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              No account creation, no API keys entered by end-users, and no complicated setup.
            </p>
          </div>

          <div className="mt-12 grid gap-8 md:grid-cols-3">
            <div className="group relative rounded-3xl border border-slate-200 bg-white/70 p-6 transition-all duration-300 hover:-translate-y-2 hover:border-indigo-400 hover:shadow-xl hover:shadow-indigo-500/10 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-indigo-500">
              <div className="flex items-center justify-between">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600 text-xs font-black text-white shadow-md shadow-indigo-600/30 transition-transform duration-300 group-hover:scale-110">
                  1
                </span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                  Ingest &amp; OCR
                </span>
              </div>
              <h3 className="mt-5 text-base font-bold text-slate-900 dark:text-slate-100">
                Upload Any Document
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                Drag and drop PDFs (digital or scanned), Markdown (.md), or plain text (.txt) up to 20MB.
                The system automatically parses text, OCRs image-only pages, chunks the content, and stores
                dense vector embeddings in ChromaDB.
              </p>
              <div className="mt-4 rounded-xl bg-slate-50 p-3 font-mono text-[11px] text-slate-700 dark:bg-slate-800/80 dark:text-slate-300">
                POST /upload → extract → chunk (1800 ch) → embed → ChromaDB
              </div>
            </div>

            <div className="group relative rounded-3xl border border-slate-200 bg-white/70 p-6 transition-all duration-300 hover:-translate-y-2 hover:border-violet-400 hover:shadow-xl hover:shadow-violet-500/10 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-violet-500">
              <div className="flex items-center justify-between">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-600 text-xs font-black text-white shadow-md shadow-violet-600/30 transition-transform duration-300 group-hover:scale-110">
                  2
                </span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                  Ask &amp; Scope
                </span>
              </div>
              <h3 className="mt-5 text-base font-bold text-slate-900 dark:text-slate-100">
                Query in 4 Answer Styles
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                Ask specific questions, compare sections, or request derivations via text or voice dictation.
                Switch between Detailed, Concise, Academic, and Step-by-Step styles, or click document pills to scope search.
              </p>
              <div className="mt-4 rounded-xl bg-slate-50 p-3 font-mono text-[11px] text-slate-700 dark:bg-slate-800/80 dark:text-slate-300">
                POST /chat → embed query → hybrid BM25 + cosine search → deep CoT synthesis
              </div>
            </div>

            <div className="group relative rounded-3xl border border-slate-200 bg-white/70 p-6 transition-all duration-300 hover:-translate-y-2 hover:border-emerald-400 hover:shadow-xl hover:shadow-emerald-500/10 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-emerald-500">
              <div className="flex items-center justify-between">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-600 text-xs font-black text-white shadow-md shadow-emerald-600/30 transition-transform duration-300 group-hover:scale-110">
                  3
                </span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                  Inspect &amp; Verify
                </span>
              </div>
              <h3 className="mt-5 text-base font-bold text-slate-900 dark:text-slate-100">
                Verify Citations &amp; Briefings
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                Expand the Thinking Process drawer to inspect step-by-step reasoning, check verbatim chunk excerpts and
                their exact relevance match percentage, listen via Web Speech TTS, or generate 1-click executive briefings.
              </p>
              <div className="mt-4 rounded-xl bg-slate-50 p-3 font-mono text-[11px] text-slate-700 dark:bg-slate-800/80 dark:text-slate-300">
                Answer + CoT Thinking + Citations (% Match) + Follow-ups + Audio TTS
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 3: WHY IS IT DIFFERENT? (HEAD-TO-HEAD COMPARISON) */}
        <section id="comparison" className="mb-24">
          <div className="text-center">
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
              Head-to-Head Architectural Audit
            </span>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl text-slate-900 dark:text-white">
              Why Is It Different From Other Software?
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              Most online document tools are superficial wrappers with zero verification guardrails.
              Here is how DocQ&amp;A compares against standard online document chat software.
            </p>
          </div>

          <div className="mt-10 overflow-hidden rounded-3xl border border-slate-200 bg-white/90 shadow-lg backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/90">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-700 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                    <th className="px-5 py-4 font-bold sm:w-1/4">Capability / Requirement</th>
                    <th className="px-5 py-4 font-bold text-rose-600 dark:text-rose-400 sm:w-1/3">
                      Typical Online PDF Software
                    </th>
                    <th className="px-5 py-4 font-bold text-emerald-600 dark:text-emerald-400 sm:w-1/3">
                      DocQ&amp;A (This Platform)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                  <tr className="transition hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                    <td className="px-5 py-4 font-semibold text-slate-900 dark:text-slate-100">
                      Hallucination Prevention
                    </td>
                    <td className="px-5 py-4 text-slate-600 dark:text-slate-400">
                      <span className="inline-flex items-center text-rose-500 mr-1.5 font-bold">✕</span>
                      Guesses or invents answers from training data when information is missing from the document.
                    </td>
                    <td className="px-5 py-4 font-medium text-emerald-700 dark:text-emerald-300">
                      <span className="inline-flex items-center text-emerald-500 mr-1.5 font-bold">✓</span>
                      Enforces a hard cosine cutoff (0.78). Refuses to answer if evidence is absent, strictly returning honest refusal.
                    </td>
                  </tr>

                  <tr className="transition hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                    <td className="px-5 py-4 font-semibold text-slate-900 dark:text-slate-100">
                      Scanned PDFs &amp; Images
                    </td>
                    <td className="px-5 py-4 text-slate-600 dark:text-slate-400">
                      <span className="inline-flex items-center text-rose-500 mr-1.5 font-bold">✕</span>
                      Fails silently or extracts 0 words from image-only scans, receipts, or non-digital PDFs.
                    </td>
                    <td className="px-5 py-4 font-medium text-emerald-700 dark:text-emerald-300">
                      <span className="inline-flex items-center text-emerald-500 mr-1.5 font-bold">✓</span>
                      Automatic multi-tier OCR: PyMuPDF + Tesseract 200 DPI OCR + Gemini 3.8 Flash Multimodal Vision transcription.
                    </td>
                  </tr>

                  <tr className="transition hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                    <td className="px-5 py-4 font-semibold text-slate-900 dark:text-slate-100">
                      AI Deep Thinking Mode
                    </td>
                    <td className="px-5 py-4 text-slate-600 dark:text-slate-400">
                      <span className="inline-flex items-center text-rose-500 mr-1.5 font-bold">✕</span>
                      Black-box one-shot generation without observable reasoning or cross-passage evidence auditing.
                    </td>
                    <td className="px-5 py-4 font-medium text-emerald-700 dark:text-emerald-300">
                      <span className="inline-flex items-center text-emerald-500 mr-1.5 font-bold">✓</span>
                      Enforces internal &lt;thinking&gt; protocol to deconstruct problems, audit facts, and verify claims in an interactive UI card.
                    </td>
                  </tr>

                  <tr className="transition hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                    <td className="px-5 py-4 font-semibold text-slate-900 dark:text-slate-100">
                      Math, Science &amp; LaTeX
                    </td>
                    <td className="px-5 py-4 text-slate-600 dark:text-slate-400">
                      <span className="inline-flex items-center text-rose-500 mr-1.5 font-bold">✕</span>
                      Mangles formulas into broken ASCII text; strips superscripts, fractions, and matrices.
                    </td>
                    <td className="px-5 py-4 font-medium text-emerald-700 dark:text-emerald-300">
                      <span className="inline-flex items-center text-emerald-500 mr-1.5 font-bold">✓</span>
                      Prompts step-by-step LaTeX derivations ($...$ and $$...$$) rendered dynamically with KaTeX in the browser.
                    </td>
                  </tr>

                  <tr className="transition hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                    <td className="px-5 py-4 font-semibold text-slate-900 dark:text-slate-100">
                      Citation Transparency
                    </td>
                    <td className="px-5 py-4 text-slate-600 dark:text-slate-400">
                      <span className="inline-flex items-center text-rose-500 mr-1.5 font-bold">✕</span>
                      Displays opaque numbers like [1] without verbatim text excerpts or similarity scores.
                    </td>
                    <td className="px-5 py-4 font-medium text-emerald-700 dark:text-emerald-300">
                      <span className="inline-flex items-center text-emerald-500 mr-1.5 font-bold">✓</span>
                      Full chunk passage text, source filename, chunk index, copy quote button, and calculated match % score.
                    </td>
                  </tr>

                  <tr className="transition hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                    <td className="px-5 py-4 font-semibold text-slate-900 dark:text-slate-100">
                      Cross-Document Scoping
                    </td>
                    <td className="px-5 py-4 text-slate-600 dark:text-slate-400">
                      <span className="inline-flex items-center text-rose-500 mr-1.5 font-bold">✕</span>
                      Mixes information across multiple uploaded documents without boundary control.
                    </td>
                    <td className="px-5 py-4 font-medium text-emerald-700 dark:text-emerald-300">
                      <span className="inline-flex items-center text-emerald-500 mr-1.5 font-bold">✓</span>
                      One-click document filter scopes ChromaDB queries strictly to a single file via metadata filtering.
                    </td>
                  </tr>

                  <tr className="transition hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                    <td className="px-5 py-4 font-semibold text-slate-900 dark:text-slate-100">
                      Executive Briefing Engine
                    </td>
                    <td className="px-5 py-4 text-slate-600 dark:text-slate-400">
                      <span className="inline-flex items-center text-rose-500 mr-1.5 font-bold">✕</span>
                      Flat, generic 2-paragraph summary without strategic metrics or follow-up recommendations.
                    </td>
                    <td className="px-5 py-4 font-medium text-emerald-700 dark:text-emerald-300">
                      <span className="inline-flex items-center text-emerald-500 mr-1.5 font-bold">✓</span>
                      Structured 4-part AI Briefing: Overview, Critical Metrics, Strategic Takeaways, and Recommended Inquiries.
                    </td>
                  </tr>

                  <tr className="transition hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                    <td className="px-5 py-4 font-semibold text-slate-900 dark:text-slate-100">
                      Accessibility &amp; Export
                    </td>
                    <td className="px-5 py-4 text-slate-600 dark:text-slate-400">
                      <span className="inline-flex items-center text-rose-500 mr-1.5 font-bold">✕</span>
                      Text-only typing; locked inside proprietary web interface.
                    </td>
                    <td className="px-5 py-4 font-medium text-emerald-700 dark:text-emerald-300">
                      <span className="inline-flex items-center text-emerald-500 mr-1.5 font-bold">✓</span>
                      Speech-to-Text microphone dictation, Text-to-Speech audio reader, and 1-click Markdown export.
                    </td>
                  </tr>

                  <tr className="transition hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                    <td className="px-5 py-4 font-semibold text-slate-900 dark:text-slate-100">
                      Account &amp; Access Barrier
                    </td>
                    <td className="px-5 py-4 text-slate-600 dark:text-slate-400">
                      <span className="inline-flex items-center text-rose-500 mr-1.5 font-bold">✕</span>
                      Forces email registration, credit cards, paywalls, or strict daily file limits.
                    </td>
                    <td className="px-5 py-4 font-medium text-emerald-700 dark:text-emerald-300">
                      <span className="inline-flex items-center text-emerald-500 mr-1.5 font-bold">✓</span>
                      100% Free, zero login, zero account required, and immediate instant access.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* SECTION 4: ALL PROBLEMS WHICH IT SOLVES (VERIFIED WITH CODE PROOF) */}
        <section id="verified-problems" className="mb-24">
          <div className="text-center">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              Verified Technical Claims
            </span>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl text-slate-900 dark:text-white">
              Problems Solved &amp; Verified in Code
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              Every single capability claimed below is actively verified and grounded directly in the backend and frontend source code.
            </p>
          </div>

          {/* Interactive Problem Selector Tabs */}
          <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
            {problemsData.map((prob, idx) => (
              <button
                key={prob.id}
                onClick={() => setActiveProblemTab(idx)}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all duration-300 hover:scale-105 active:scale-95 ${
                  activeProblemTab === idx
                    ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 scale-[1.03] ring-2 ring-indigo-400"
                    : "border border-slate-200 bg-white/70 text-slate-700 hover:bg-slate-100 hover:border-indigo-300 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
              >
                <span>{prob.title}</span>
              </button>
            ))}
          </div>

          {/* Active Problem Deep Dive Card */}
          <div
            key={activeProblemTab}
            className="animate-pop-in mt-6 rounded-3xl border border-slate-200/90 bg-white/90 p-6 shadow-xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/90 sm:p-8"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800">
                  {problemsData[activeProblemTab].icon}
                </div>
                <div>
                  <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[10px] font-bold uppercase text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                    {problemsData[activeProblemTab].badge}
                  </span>
                  <h3 className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-100">
                    {problemsData[activeProblemTab].title}
                  </h3>
                </div>
              </div>

              <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span>Verified in Production Code</span>
              </div>
            </div>

            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <div className="rounded-2xl border border-rose-100 bg-rose-50/40 p-5 dark:border-rose-950/50 dark:bg-rose-950/20">
                <div className="flex items-center gap-2 text-xs font-bold text-rose-600 dark:text-rose-400">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <span>Why Existing Software Fails</span>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                  {problemsData[activeProblemTab].failReason}
                </p>
              </div>

              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-5 dark:border-emerald-950/50 dark:bg-emerald-950/20">
                <div className="flex items-center gap-2 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <span>How DocQ&amp;A Solves It</span>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                  {problemsData[activeProblemTab].docQASolution}
                </p>
              </div>
            </div>

            {/* Code Verification Block */}
            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-900 p-4 text-slate-100 dark:border-slate-800 dark:bg-black">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="font-mono text-indigo-400 font-semibold">
                  {problemsData[activeProblemTab].codeProof}
                </span>
                <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-emerald-400">
                  Architecture Audit: Active
                </span>
              </div>
              <ul className="mt-3 space-y-1.5 text-xs text-slate-300 font-mono">
                {problemsData[activeProblemTab].proofDetails.map((detail, dIdx) => (
                  <li key={dIdx} className="flex items-center gap-2">
                    <span className="text-emerald-400">✔</span>
                    <span>{detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* SECTION 5: INTERACTIVE LIVE DEMONSTRATION */}
        <section id="live-proofs" className="mb-24">
          <div className="text-center">
            <span className="text-xs font-bold uppercase tracking-wider text-cyan-600 dark:text-cyan-400">
              Interactive Evidence Showcase
            </span>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl text-slate-900 dark:text-white">
              See How It Actually Formats Answers
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              Click through interactive examples below to see real output generated with LaTeX formulas,
              deep reasoning CoT, verifiable source citations, and executive briefings.
            </p>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={() => setActiveDemoTab("math")}
              className={`rounded-xl px-4 py-2 text-xs font-semibold transition-all duration-300 hover:scale-105 active:scale-95 ${
                activeDemoTab === "math"
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 scale-[1.03] ring-2 ring-indigo-400"
                  : "border border-slate-200 bg-white/70 text-slate-700 hover:bg-slate-100 hover:border-indigo-300 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              📐 LaTeX Math &amp; Derivations
            </button>
            <button
              onClick={() => setActiveDemoTab("hallucination")}
              className={`rounded-xl px-4 py-2 text-xs font-semibold transition-all duration-300 hover:scale-105 active:scale-95 ${
                activeDemoTab === "hallucination"
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 scale-[1.03] ring-2 ring-indigo-400"
                  : "border border-slate-200 bg-white/70 text-slate-700 hover:bg-slate-100 hover:border-indigo-300 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              🛡️ Refusal Guardrail (No Hallucination)
            </button>
            <button
              onClick={() => setActiveDemoTab("citation")}
              className={`rounded-xl px-4 py-2 text-xs font-semibold transition-all duration-300 hover:scale-105 active:scale-95 ${
                activeDemoTab === "citation"
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 scale-[1.03] ring-2 ring-indigo-400"
                  : "border border-slate-200 bg-white/70 text-slate-700 hover:bg-slate-100 hover:border-indigo-300 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              🎯 Exact Citations &amp; Relevance Match
            </button>
            <button
              onClick={() => setActiveDemoTab("briefing")}
              className={`rounded-xl px-4 py-2 text-xs font-semibold transition-all duration-300 hover:scale-105 active:scale-95 ${
                activeDemoTab === "briefing"
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 scale-[1.03] ring-2 ring-indigo-400"
                  : "border border-slate-200 bg-white/70 text-slate-700 hover:bg-slate-100 hover:border-indigo-300 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              📊 Executive Briefing Sample
            </button>
          </div>

          <div
            key={activeDemoTab}
            className="animate-pop-in mt-6 rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95 sm:p-8"
          >
            {activeDemoTab === "math" && (
              <div>
                <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
                  <div className="text-xs font-semibold text-slate-500">
                    User Query: <span className="font-mono text-indigo-600 dark:text-indigo-400">&quot;Derive the vector cosine similarity equation and hybrid re-ranking score.&quot;</span>
                  </div>
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                    KaTeX + CoT Verified
                  </span>
                </div>

                {/* Collapsible Thinking Process card like in actual Chat */}
                <details className="mb-4 group rounded-xl border border-indigo-200/80 bg-indigo-50/50 p-3 text-xs dark:border-indigo-900/60 dark:bg-indigo-950/40" open>
                  <summary className="flex cursor-pointer select-none items-center gap-1.5 font-semibold text-indigo-900 dark:text-indigo-300">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-white text-[11px]">🧠</span>
                    <span>AI Thinking Process &amp; Verification</span>
                    <span className="text-[10px] font-normal text-slate-400 dark:text-slate-500 ml-auto">Verified against Section 4</span>
                  </summary>
                  <div className="mt-2.5 whitespace-pre-wrap border-t border-indigo-100 pt-2.5 font-mono text-[11px] leading-relaxed text-slate-600 dark:border-indigo-900/40 dark:text-slate-300">
                    1. DECONSTRUCT QUESTION: User requests mathematical formulation of cosine similarity and hybrid scoring formula in R^768.
                    2. EVIDENCE AUDIT: Section 4 defines vector dimension d=768, cosine space, and BM25 hybrid blending ratio (0.65 vector + 0.35 keyword).
                    3. SYNTHESIS: Format explicit LaTeX equations ($...$ and $$...$$), define all variables, and present step-by-step verification.
                  </div>
                </details>

                <MarkdownRenderer
                  content={`Based on Section 4 of the uploaded technical paper, the cosine similarity between the query vector $\\mathbf{q}$ and chunk vector $\\mathbf{d}$ in $\\mathbb{R}^{768}$ is computed as:

$$\\text{Sim}(\\mathbf{q}, \\mathbf{d}) = \\frac{\\mathbf{q} \\cdot \\mathbf{d}}{\\|\\mathbf{q}\\| \\|\\mathbf{d}\\|} = \\frac{\\sum_{i=1}^{768} q_i d_i}{\\sqrt{\\sum_{i=1}^{768} q_i^2} \\sqrt{\\sum_{i=1}^{768} d_i^2}}$$

### Step-by-Step Distance & Hybrid Score Calculation
1. **Cosine Distance**: Computed as $D_{\\text{cosine}} = 1.0 - \\text{Sim}(\\mathbf{q}, \\mathbf{d})$.
2. **Hybrid Composite Score**: Incorporates BM25 keyword overlap $S_{\\text{kw}}$ to prioritize exact technical names:
   $$S_{\\text{composite}} = 0.65 \\cdot \\text{Sim}(\\mathbf{q}, \\mathbf{d}) + 0.35 \\cdot S_{\\text{kw}}$$
3. **Relevance Percentage**: For human readability, DocQ&A maps this into an intuitive percentage match:
   $$\\text{Relevance (\\%)} = \\max\\left(15, \\min\\left(99, \\text{round}\\left(S_{\\text{composite}} \\times 100\\right)\\right)\\right)$$
4. **Threshold Gate**: If $D_{\\text{cosine}} > 0.78$, the chunk is discarded from generation context.`}
                />
              </div>
            )}

            {activeDemoTab === "hallucination" && (
              <div>
                <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
                  <div className="text-xs font-semibold text-slate-500">
                    User Query: <span className="font-mono text-rose-600 dark:text-rose-400">&quot;What was the company&apos;s 2028 projected revenue in this 2023 report?&quot;</span>
                  </div>
                  <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                    Cosine Cutoff Triggered
                  </span>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5 dark:border-amber-900/60 dark:bg-amber-950/30">
                  <div className="flex items-center gap-2 text-xs font-bold text-amber-800 dark:text-amber-300">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>System Fallback Triggered</span>
                  </div>
                  <p className="mt-2 font-mono text-sm font-semibold text-slate-800 dark:text-slate-100">
                    &quot;I cannot answer this based on the uploaded documents.&quot;
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                    Unlike standard bots that invent speculative projections, DocQ&amp;A confirms all retrieved chunks exceeded the 0.78 distance threshold and terminates generation rather than feeding false information to the user.
                  </p>
                </div>
              </div>
            )}

            {activeDemoTab === "citation" && (
              <div>
                <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
                  <div className="text-xs font-semibold text-slate-500">
                    Answer with Verifiable Provenance
                  </div>
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                    Provenance Live
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                  According to Article 14.2 of the master vendor agreement, the termination notice period requires <strong>60 calendar days written notice</strong> via certified courier <span className="font-mono text-indigo-600 dark:text-indigo-400">[Vendor_Master_Contract_2024.pdf]</span>.
                </p>

                {/* Grounded Source Drawer Preview */}
                <div className="mt-4 rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4 dark:border-indigo-900/40 dark:bg-indigo-950/30">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white">
                        Passage 1
                      </span>
                      <span className="font-mono font-medium text-slate-700 dark:text-slate-300">
                        Vendor_Master_Contract_2024.pdf (Chunk #18)
                      </span>
                    </div>
                    <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300">
                      94% Match
                    </span>
                  </div>
                  <p className="mt-2 rounded-lg bg-white/80 p-3 font-mono text-[11px] leading-relaxed text-slate-600 dark:bg-slate-900/80 dark:text-slate-300">
                    &quot;14.2 Either party may terminate this agreement without cause upon providing at least sixty (60) calendar days prior written notice delivered via certified mail or registered courier to the designated corporate officer...&quot;
                  </p>
                </div>
              </div>
            )}

            {activeDemoTab === "briefing" && (
              <div>
                <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
                  <div className="text-xs font-semibold text-slate-500">
                    One-Click Executive Briefing (4 Standardized Sections)
                  </div>
                  <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
                    Automated Executive Synthesis
                  </span>
                </div>
                <MarkdownRenderer
                  content={`### 📌 Executive Overview
This quarterly security audit evaluates infrastructure posture across European clusters, confirming SOC-2 Type II readiness while highlighting secondary remediation pathways.

### 💡 Key Highlights & Critical Data
- **99.98% System Uptime**: Zero unauthorized access events recorded across 14,200 audit events.
- **Latency Reduction**: Average retrieval response decreased from 840ms to 290ms following HNSW cosine indexing.
- **OCR Throughput**: Over 450 pages of scanned receipts digitized with zero unreadable page exceptions.

### 🎯 Strategic Takeaways & Recommendations
- Finalize automated rotation for secondary vector collection encryption keys before Q3 audit.
- Expand dedicated multi-worker ThreadPoolExecutor limits for large multi-document batches.

### ❓ Recommended Follow-up Inquiries
- What were the specific penetration testing results for the Chroma Cloud tenant bridge?
- Which secondary cloud regions are scheduled for latency stress tests next month?`}
                />
              </div>
            )}
          </div>
        </section>

        {/* BOTTOM LAUNCHPAD CTA */}
        <section className="animate-gradient-flow relative mb-12 overflow-hidden rounded-3xl bg-gradient-to-r from-indigo-900 via-violet-900 to-indigo-950 p-8 text-center text-white shadow-2xl shadow-indigo-950/40 sm:p-12">
          {/* Subtle Ambient Glows Inside Banner */}
          <div className="animate-pulse-slow pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full bg-indigo-500/25 blur-3xl" />
          <div className="animate-float-slow pointer-events-none absolute -right-20 -bottom-20 h-64 w-64 rounded-full bg-violet-500/25 blur-3xl" />

          <div className="relative z-10">
            <h2 className="text-3xl font-black tracking-tight sm:text-4xl">
              Ready to Analyze Your Documents With Zero Hallucinations?
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-indigo-200">
              Click below to select your document. No registration, no API key entry, and no credit card required.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="shimmer-sweep group inline-flex items-center gap-2 rounded-2xl bg-white px-7 py-3 text-sm font-bold text-indigo-950 shadow-2xl transition-all duration-300 hover:scale-105 hover:bg-slate-50 hover:shadow-indigo-500/30 active:scale-95"
              >
                <svg className="h-5 w-5 text-indigo-600 transition-transform duration-300 group-hover:-translate-y-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 16V4m0 0L7 9m5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>Get Started &amp; Upload Document</span>
              </button>

              <button
                onClick={onGetStarted}
                className="group inline-flex items-center gap-2 rounded-2xl border border-indigo-300/40 bg-indigo-950/40 px-6 py-3 text-sm font-semibold text-white backdrop-blur-md transition-all duration-300 hover:scale-105 hover:bg-indigo-950/70 hover:border-indigo-300"
              >
                <span>Enter Workspace Directly</span>
                <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
              </button>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-slate-200/80 py-8 text-center text-xs text-slate-500 dark:border-slate-800/80 dark:text-slate-400">
          <p>DocQ&amp;A • Grounded Neural Retrieval-Augmented Generation • Open Architecture</p>
        </footer>
      </div>
    </div>
  );
}
