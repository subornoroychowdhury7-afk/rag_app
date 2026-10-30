"use client";

import { useEffect, useRef, useState } from "react";
import { sendChat, type Citation } from "@/lib/api";
import MarkdownRenderer from "./MarkdownRenderer";

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: string[];
  citations?: Citation[];
  suggestedFollowups?: string[];
  isError?: boolean;
  timestamp: Date;
}

interface ChatProps {
  hasDocs: boolean;
  docs?: { name: string; chunks: number }[];
  selectedDocFilter?: string | null;
  onSelectDocFilter?: (docName: string | null) => void;
}

/* ---------- Sub-components ---------------------------------------- */

function TypingIndicator() {
  return (
    <div className="animate-fade-in-up flex items-start gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 shadow-sm">
        <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
          />
        </svg>
      </div>
      <div className="rounded-2xl rounded-tl-md border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="inline-block h-2 w-2 rounded-full bg-indigo-400 dark:bg-indigo-500"
              style={{
                animation: "bounce-dot 1.4s ease-in-out infinite",
                animationDelay: `${i * 0.16}s`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function CitationsView({
  citations,
  sources,
}: {
  citations?: Citation[];
  sources?: string[];
}) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const items = citations && citations.length > 0
    ? citations
    : (sources || []).map((s) => ({ text: s, source: "Document", relevance: 85 }));

  if (items.length === 0) return null;

  function copyPassage(text: string, index: number) {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  }

  return (
    <details className="group mt-2.5 ml-11 text-sm">
      <summary className="inline-flex cursor-pointer select-none items-center gap-1.5 rounded-lg border border-slate-200/80 bg-white/70 px-3 py-1 text-xs font-semibold text-slate-600 shadow-xs transition-colors hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700/80 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:border-indigo-600 dark:hover:text-indigo-300">
        <svg className="h-3.5 w-3.5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
        <span>
          {items.length} Grounded Source{items.length !== 1 ? "s" : ""}
        </span>
      </summary>

      <div className="mt-2.5 space-y-2">
        {items.map((c, i) => (
          <div
            key={i}
            className="rounded-xl border border-slate-200/90 bg-white/80 p-3 shadow-xs dark:border-slate-700/80 dark:bg-slate-800/50"
          >
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                  Passage {i + 1}
                </span>
                <span className="truncate text-xs font-medium text-slate-600 dark:text-slate-300" title={c.source}>
                  {c.source}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {c.relevance && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${c.relevance >= 70
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400"
                        : "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-400"
                      }`}
                  >
                    {c.relevance}% Match
                  </span>
                )}
                <button
                  onClick={() => copyPassage(c.text, i)}
                  className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
                  title="Copy passage quote"
                >
                  {copiedIndex === i ? (
                    <svg className="h-3.5 w-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              {c.text}
            </p>
          </div>
        ))}
      </div>
    </details>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="rounded-md p-1.5 text-slate-400 opacity-0 transition-all hover:bg-slate-100 hover:text-slate-600 group-hover:opacity-100 dark:hover:bg-slate-700 dark:hover:text-slate-300"
      title="Copy response"
    >
      {copied ? (
        <svg className="h-4 w-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        </svg>
      )}
    </button>
  );
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/* ---------- Main component ---------------------------------------- */

const MAX_CHARS = 10000;

interface SpeechRecognitionEventLike {
  results?: {
    [index: number]: {
      [index: number]: {
        transcript?: string;
      };
    };
  };
}

interface SpeechRecognitionInstanceLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: () => void;
  onresult: (event: SpeechRecognitionEventLike) => void;
  onerror: (event: { error?: string }) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
}

export default function Chat({
  hasDocs,
  selectedDocFilter,
  onSelectDocFilter,
}: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const [answerMode, setAnswerMode] = useState<"detailed" | "concise" | "academic" | "step_by_step">("detailed");

  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstanceLike | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    setShowScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight > 100);
  }

  function scrollToBottom() {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  /* ---- Voice Dictation (Speech to Text) ---- */
  function toggleListening() {
    if (isListening) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsListening(false);
      return;
    }

    const win = typeof window !== "undefined"
      ? (window as unknown as {
        SpeechRecognition?: new () => SpeechRecognitionInstanceLike;
        webkitSpeechRecognition?: new () => SpeechRecognitionInstanceLike;
      })
      : {};

    const SpeechRecognition = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in this browser. Try Chrome, Edge, or Safari.");
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = navigator.language || "en-US";

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        const transcript = event.results?.[0]?.[0]?.transcript;
        if (transcript) {
          setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
        }
      };

      recognition.onerror = (event: { error?: string }) => {
        console.warn("Speech recognition error:", event.error);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error("Could not start speech recognition:", err);
      setIsListening(false);
    }
  }

  /* ---- Read Aloud (Text to Speech) ---- */
  function toggleSpeak(idx: number, text: string) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      alert("Text-to-speech is not supported in this browser.");
      return;
    }

    if (speakingIdx === idx) {
      window.speechSynthesis.cancel();
      setSpeakingIdx(null);
      return;
    }

    window.speechSynthesis.cancel();

    // Strip markdown formatting for natural voice cadence
    const cleanText = text
      .replace(/[#*`_~>[\]()]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    utterance.onend = () => setSpeakingIdx(null);
    utterance.onerror = () => setSpeakingIdx(null);

    window.speechSynthesis.speak(utterance);
    setSpeakingIdx(idx);
  }

  /* ---- Chat Export to Markdown ---- */
  function exportChat() {
    if (messages.length === 0) return;

    const header = `# DocQ&A Conversation Export\n*Exported on ${new Date().toLocaleString()} · Total Messages: ${messages.length}*\n\n---\n\n`;
    const body = messages
      .map((m) => {
        const author = m.role === "user" ? "👤 User" : "🤖 DocQ&A Assistant";
        const time = formatTime(m.timestamp);
        let out = `### ${author} (${time})\n\n${m.content}\n`;
        if (m.citations && m.citations.length > 0) {
          out += `\n**Referenced Sources:**\n`;
          m.citations.forEach((c, idx) => {
            out += `- **Passage ${idx + 1}** (${c.source} · ${c.relevance}% Match):\n  > "${c.text.replace(/\n/g, " ")}"\n`;
          });
        }
        return out;
      })
      .join("\n---\n\n");

    const blob = new Blob([header + body], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `DocQA_Chat_Export_${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function submitQuery(queryText?: string) {
    const query = (queryText !== undefined ? queryText : input).trim();
    if (!query || loading) return;

    setInput("");
    setMessages((m) => [...m, { role: "user", content: query, timestamp: new Date() }]);
    setLoading(true);

    try {
      const history = messages
        .filter((m) => !m.isError)
        .map((m) => ({ role: m.role, content: m.content.slice(0, 32000) }));

      const res = await sendChat(query, history, selectedDocFilter, answerMode);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: res.answer,
          sources: res.sources,
          citations: res.citations,
          suggestedFollowups: res.suggested_followups,
          timestamp: new Date(),
        },
      ]);
    } catch (err) {
      const content = err instanceof Error ? err.message : "Something went wrong.";
      setMessages((m) => [...m, { role: "assistant", content, isError: true, timestamp: new Date() }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-slate-50/50 dark:bg-slate-950">
      {/* Messages Viewport */}
      <div ref={scrollRef} onScroll={handleScroll} className="relative flex-1 overflow-y-auto px-4 py-6 md:px-10">
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          {/* Top Actions: Export and Clear */}
          {messages.length > 0 && !loading && (
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={exportChat}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1 text-xs font-medium text-slate-600 shadow-xs transition hover:border-slate-300 hover:text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                title="Export conversation as Markdown"
              >
                <svg className="h-3.5 w-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span>Export Chat</span>
              </button>

              <button
                onClick={() => {
                  window.speechSynthesis?.cancel();
                  setSpeakingIdx(null);
                  setMessages([]);
                }}
                className="rounded-full border border-slate-200 bg-white px-3.5 py-1 text-xs font-medium text-slate-500 shadow-xs transition hover:border-slate-300 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
              >
                ✕ Clear
              </button>
            </div>
          )}

          {/* Empty State */}
          {messages.length === 0 && (
            <div className="animate-fade-in-up mt-16 flex flex-col items-center text-center">
              <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-xl shadow-indigo-500/25">
                <svg
                  className="h-10 w-10 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                  />
                </svg>
              </div>

              <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 sm:text-2xl">
                {hasDocs ? "Ask anything about your knowledge base" : "Upload documents to begin"}
              </h2>

              <p className="mt-2 max-w-md text-sm text-slate-500 dark:text-slate-400">
                {hasDocs
                  ? "DocQ&A searches your uploaded PDF, Markdown, and TXT files using vector similarity and provides verified answers."
                  : "Drop files in the left sidebar to index them with Gemini neural embeddings."}
              </p>

              {hasDocs && (
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {[
                    "Summarize the key points",
                    "What are the main findings or metrics?",
                    "What actionable recommendations are outlined?",
                  ].map((q) => (
                    <button
                      key={q}
                      onClick={() => submitQuery(q)}
                      className="rounded-full border border-slate-200/90 bg-white px-4 py-2 text-xs font-medium text-slate-700 shadow-xs transition hover:border-indigo-300 hover:text-indigo-600 hover:shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-indigo-600 dark:hover:text-indigo-300"
                    >
                      💡 {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Message History */}
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="animate-fade-in-up flex justify-end">
                <div className="flex max-w-[80%] flex-col items-end gap-1">
                  <p className="whitespace-pre-wrap rounded-2xl rounded-br-md bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-2.5 text-sm leading-relaxed text-white shadow-sm">
                    {m.content}
                  </p>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">
                    {formatTime(m.timestamp)}
                  </span>
                </div>
              </div>
            ) : (
              <div key={i} className="animate-fade-in-up flex flex-col">
                <div className="group flex items-start gap-3">
                  {/* Bot Avatar */}
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 shadow-sm">
                    <svg
                      className="h-4 w-4 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
                      />
                    </svg>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div
                      className={`rounded-2xl rounded-tl-md border px-4 py-3 text-sm leading-relaxed ${m.isError
                          ? "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300"
                          : "border-slate-200/90 bg-white text-slate-800 shadow-xs dark:border-slate-700/80 dark:bg-slate-800 dark:text-slate-200"
                        }`}
                    >
                      {m.isError ? m.content : <MarkdownRenderer content={m.content} />}
                    </div>

                    {/* Action Bar (Copy + Speak) */}
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className="text-[11px] text-slate-400 dark:text-slate-500">
                        {formatTime(m.timestamp)}
                      </span>
                      {!m.isError && (
                        <>
                          <CopyButton text={m.content} />
                          <button
                            onClick={() => toggleSpeak(i, m.content)}
                            className="rounded-md p-1.5 text-slate-400 opacity-0 transition-all hover:bg-slate-100 hover:text-slate-600 group-hover:opacity-100 dark:hover:bg-slate-700 dark:hover:text-slate-300"
                            title={speakingIdx === i ? "Stop speaking" : "Read aloud"}
                          >
                            {speakingIdx === i ? (
                              <svg className="h-4 w-4 text-indigo-600 dark:text-indigo-400 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                              </svg>
                            ) : (
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.757 3.63 8.25 4.51 8.25H6.75z"
                                />
                              </svg>
                            )}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Grounded Citations with relevance percentages */}
                {(m.citations || m.sources) && (
                  <CitationsView citations={m.citations} sources={m.sources} />
                )}

                {/* Suggested Follow-ups */}
                {m.suggestedFollowups && m.suggestedFollowups.length > 0 && (
                  <div className="mt-3 ml-11 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
                      Suggested:
                    </span>
                    {m.suggestedFollowups.map((q, qIdx) => (
                      <button
                        key={qIdx}
                        onClick={() => submitQuery(q)}
                        className="rounded-full border border-indigo-200/80 bg-indigo-50/70 px-3 py-1 text-xs font-medium text-indigo-700 shadow-2xs transition hover:border-indigo-300 hover:bg-indigo-100 hover:shadow-xs dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-900/50"
                      >
                        ✨ {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          )}

          {loading && <TypingIndicator />}
          <div ref={endRef} />
        </div>

        {/* Scroll-to-bottom FAB */}
        {showScrollBtn && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-4 right-4 rounded-full border border-slate-200 bg-white p-2.5 shadow-lg transition-all hover:shadow-xl dark:border-slate-700 dark:bg-slate-800 md:right-10"
            aria-label="Scroll to bottom"
          >
            <svg
              className="h-5 w-5 text-slate-500 dark:text-slate-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </button>
        )}
      </div>

      {/* Input Dock */}
      <div className="border-t border-slate-200/80 bg-white/90 px-4 py-3 backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-900/90 md:px-10">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {/* Active Document Filter Badge */}
          {selectedDocFilter && (
            <div className="flex items-center justify-between rounded-xl border border-indigo-200 bg-indigo-50/80 px-3 py-1.5 text-xs text-indigo-800 dark:border-indigo-900/60 dark:bg-indigo-950/50 dark:text-indigo-300">
              <div className="flex items-center gap-2 truncate">
                <span className="flex h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
                <span className="font-semibold">Scoped Query:</span>
                <span className="truncate font-mono text-[11px] underline">
                  {selectedDocFilter}
                </span>
              </div>
              <button
                onClick={() => onSelectDocFilter && onSelectDocFilter(null)}
                className="ml-2 font-semibold text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-200"
              >
                ✕ Search All Docs
              </button>
            </div>
          )}

          {/* Answer Style Mode Selector */}
          <div className="flex flex-wrap items-center justify-between gap-1.5 px-0.5">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="font-medium text-slate-400 dark:text-slate-500">Style:</span>
              <div className="inline-flex rounded-lg border border-slate-200/80 bg-slate-100/70 p-0.5 dark:border-slate-700/80 dark:bg-slate-800/80">
                <button
                  type="button"
                  onClick={() => setAnswerMode("detailed")}
                  className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-all ${answerMode === "detailed"
                      ? "bg-white text-indigo-700 shadow-2xs dark:bg-slate-700 dark:text-indigo-300 font-semibold"
                      : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                    }`}
                  title="Thorough analysis with comprehensive evidence, comparisons, and derivations"
                >
                  📖 Detailed
                </button>
                <button
                  type="button"
                  onClick={() => setAnswerMode("concise")}
                  className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-all ${answerMode === "concise"
                      ? "bg-white text-indigo-700 shadow-2xs dark:bg-slate-700 dark:text-indigo-300 font-semibold"
                      : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                    }`}
                  title="Executive-grade concise summary with key takeaways and figures"
                >
                  ⚡ Concise
                </button>
                <button
                  type="button"
                  onClick={() => setAnswerMode("academic")}
                  className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-all ${answerMode === "academic"
                      ? "bg-white text-indigo-700 shadow-2xs dark:bg-slate-700 dark:text-indigo-300 font-semibold"
                      : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                    }`}
                  title="Rigorous scholarly analysis with LaTeX math derivations and methodology"
                >
                  🎓 Academic
                </button>
                <button
                  type="button"
                  onClick={() => setAnswerMode("step_by_step")}
                  className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-all ${answerMode === "step_by_step"
                      ? "bg-white text-indigo-700 shadow-2xs dark:bg-slate-700 dark:text-indigo-300 font-semibold"
                      : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                    }`}
                  title="Sequential procedural instructions with numbered steps and verification"
                >
                  🔢 Step-by-Step
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submitQuery();
                }
              }}
              rows={1}
              placeholder={
                hasDocs
                  ? selectedDocFilter
                    ? `Ask anything specifically about ${selectedDocFilter}…`
                    : "Ask questions across all indexed documents…"
                  : "Upload a document in the sidebar to start asking questions…"
              }
              disabled={!hasDocs}
              aria-label="Your question"
              className="max-h-40 min-h-11 flex-1 resize-none rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:placeholder:text-slate-500 dark:focus:border-indigo-500"
            />

            {/* Voice Dictation Button */}
            <button
              type="button"
              onClick={toggleListening}
              disabled={!hasDocs}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-all ${isListening
                  ? "bg-rose-500 text-white shadow-lg ring-4 ring-rose-500/30 animate-pulse"
                  : "border border-slate-200 bg-white text-slate-500 hover:border-indigo-300 hover:bg-slate-50 hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                } disabled:cursor-not-allowed disabled:opacity-40`}
              title={isListening ? "Listening... click to stop" : "Voice dictation (speech to text)"}
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15a3 3 0 01-3-3V4.5a3 3 0 116 0v7.5a3 3 0 01-3 3z"
                />
              </svg>
            </button>

            {/* Send Button */}
            <button
              onClick={() => submitQuery()}
              disabled={loading || !input.trim() || !hasDocs}
              className="flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 px-5 text-sm font-medium text-white shadow-sm transition-all hover:shadow-md hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
                />
              </svg>
              <span>Send</span>
            </button>
          </div>

          <div className="flex items-center justify-between px-1 text-[11px] text-slate-400 dark:text-slate-500">
            <span>
              {isListening ? (
                <span className="font-semibold text-rose-500 animate-pulse">
                  🎙️ Listening… Speak clearly into your mic
                </span>
              ) : (
                "Enter to send · Shift+Enter for new line"
              )}
            </span>
            <span className={input.length > MAX_CHARS * 0.9 ? "text-red-500" : ""}>
              {input.length > 0 ? `${input.length}/${MAX_CHARS}` : ""}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
