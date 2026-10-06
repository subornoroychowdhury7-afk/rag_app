"use client";

import { useEffect, useRef, useState } from "react";
import { sendChat } from "@/lib/api";
import MarkdownRenderer from "./MarkdownRenderer";

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: string[];
  isError?: boolean;
  timestamp: Date;
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

function Sources({ sources }: { sources: string[] }) {
  if (sources.length === 0) return null;
  return (
    <details className="group mt-2 ml-11 text-sm">
      <summary className="cursor-pointer select-none font-medium text-slate-500 transition-colors hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400">
        📎 {sources.length} source{sources.length !== 1 ? "s" : ""} referenced
      </summary>
      <ul className="mt-2 space-y-2">
        {sources.map((s, i) => (
          <li
            key={i}
            className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50"
          >
            <p className="mb-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
              Passage {i + 1}
            </p>
            <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              {s}
            </p>
          </li>
        ))}
      </ul>
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
      className="rounded-md p-1 text-slate-400 opacity-0 transition-all hover:bg-slate-100 hover:text-slate-600 group-hover:opacity-100 dark:hover:bg-slate-700 dark:hover:text-slate-300"
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

const MAX_CHARS = 2000;

export default function Chat({ hasDocs }: { hasDocs: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

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

  async function submit() {
    const query = input.trim();
    if (!query || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: query, timestamp: new Date() }]);
    setLoading(true);
    try {
      const history = messages
        .filter((m) => !m.isError)
        .map((m) => ({ role: m.role, content: m.content }));
      const res = await sendChat(query, history);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: res.answer, sources: res.sources, timestamp: new Date() },
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
      {/* Messages */}
      <div ref={scrollRef} onScroll={handleScroll} className="relative flex-1 overflow-y-auto px-4 py-6 md:px-10">
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          {/* Clear conversation */}
          {messages.length > 0 && !loading && (
            <div className="flex justify-center">
              <button
                onClick={() => setMessages([])}
                className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-medium text-slate-500 shadow-sm transition-all hover:border-slate-300 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-200"
              >
                ✕ Clear conversation
              </button>
            </div>
          )}

          {/* Empty state */}
          {messages.length === 0 && (
            <div className="animate-fade-in-up mt-20 flex flex-col items-center text-center">
              <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/25">
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
              <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200">
                {hasDocs ? "Ask anything about your documents" : "Upload a PDF to get started"}
              </h2>
              <p className="mt-2 max-w-sm text-sm text-slate-500 dark:text-slate-400">
                {hasDocs
                  ? "I'll search through your uploaded documents and provide answers with source references."
                  : "Drop a PDF in the sidebar and I'll index it for intelligent Q&A."}
              </p>
              {hasDocs && (
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {["Summarize the key points", "What are the main findings?", "Explain the methodology"].map((q) => (
                    <button
                      key={q}
                      onClick={() => setInput(q)}
                      className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 shadow-sm transition-all hover:border-indigo-300 hover:text-indigo-700 hover:shadow-md dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-indigo-600 dark:hover:text-indigo-300"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Message bubbles */}
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
                  {/* Bot avatar */}
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
                      className={`rounded-2xl rounded-tl-md border px-4 py-2.5 text-sm leading-relaxed ${
                        m.isError
                          ? "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300"
                          : "border-slate-200 bg-white text-slate-800 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                      }`}
                    >
                      {m.isError ? m.content : <MarkdownRenderer content={m.content} />}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-[11px] text-slate-400 dark:text-slate-500">
                        {formatTime(m.timestamp)}
                      </span>
                      {!m.isError && <CopyButton text={m.content} />}
                    </div>
                  </div>
                </div>
                {m.sources && <Sources sources={m.sources} />}
              </div>
            ),
          )}

          {loading && <TypingIndicator />}
          <div ref={endRef} />
        </div>

        {/* Scroll-to-bottom FAB */}
        {showScrollBtn && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-4 right-4 rounded-full border border-slate-200 bg-white p-2 shadow-lg transition-all hover:shadow-xl dark:border-slate-700 dark:bg-slate-800 md:right-10"
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

      {/* Input area */}
      <div className="border-t border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900 md:px-10">
        <div className="mx-auto flex max-w-3xl flex-col gap-1.5">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={1}
              placeholder={
                hasDocs ? "Ask a question about your documents…" : "Upload a PDF first to start asking questions…"
              }
              disabled={!hasDocs}
              aria-label="Your question"
              className="max-h-40 min-h-11 flex-1 resize-none rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:placeholder:text-slate-500 dark:focus:border-indigo-500"
            />
            <button
              onClick={submit}
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
              Send
            </button>
          </div>
          <div className="flex items-center justify-between px-1 text-[11px] text-slate-400 dark:text-slate-500">
            <span>Enter to send · Shift+Enter for new line</span>
            <span className={input.length > MAX_CHARS * 0.9 ? "text-red-500" : ""}>
              {input.length > 0 ? `${input.length}/${MAX_CHARS}` : ""}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
