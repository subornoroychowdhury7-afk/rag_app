"use client";

import { useEffect, useRef, useState } from "react";
import { sendChat } from "@/lib/api";
import Spinner from "./Spinner";

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: string[];
  isError?: boolean;
}

function Sources({ sources }: { sources: string[] }) {
  if (sources.length === 0) return null;
  return (
    <details className="group mt-2 w-full max-w-[85%] text-sm">
      <summary className="cursor-pointer select-none text-slate-500 hover:text-slate-800">
        Sources ({sources.length})
      </summary>
      <ul className="mt-2 space-y-2">
        {sources.map((s, i) => (
          <li key={i} className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="mb-1 text-xs font-medium text-slate-500">Passage {i + 1}</p>
            <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-700">{s}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}

export default function Chat({ hasDocs }: { hasDocs: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function submit() {
    const query = input.trim();
    if (!query || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: query }]);
    setLoading(true);
    try {
      const res = await sendChat(query);
      setMessages((m) => [...m, { role: "assistant", content: res.answer, sources: res.sources }]);
    } catch (err) {
      const content = err instanceof Error ? err.message : "Something went wrong.";
      setMessages((m) => [...m, { role: "assistant", content, isError: true }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-10">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {messages.length === 0 && (
            <div className="mt-16 text-center text-slate-500">
              <p className="text-base font-medium text-slate-700">
                {hasDocs ? "Ask anything about your documents." : "Upload a PDF to get started."}
              </p>
              <p className="mt-1 text-sm">Each answer shows the passages it was based on.</p>
            </div>
          )}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[#1f3a5f] px-4 py-2.5 text-sm leading-relaxed text-white">
                  {m.content}
                </p>
              </div>
            ) : (
              <div key={i} className="flex flex-col items-start">
                <p
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-md border px-4 py-2.5 text-sm leading-relaxed ${
                    m.isError ? "border-red-200 bg-red-50 text-red-800" : "border-slate-200 bg-white text-slate-800"
                  }`}
                >
                  {m.content}
                </p>
                {m.sources && <Sources sources={m.sources} />}
              </div>
            ),
          )}

          {loading && (
            <div className="flex items-center gap-2 text-sm text-slate-500" aria-live="polite">
              <Spinner /> Searching your documents…
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div className="border-t border-slate-200 bg-white px-4 py-3 md:px-10">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
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
            placeholder="Ask a question about your documents…"
            aria-label="Your question"
            className="max-h-40 min-h-11 flex-1 resize-none rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20"
          />
          <button
            onClick={submit}
            disabled={loading || !input.trim()}
            className="h-11 rounded-xl bg-[#1f3a5f] px-5 text-sm font-medium text-white transition-colors hover:bg-[#2a4a77] focus-visible:ring-2 focus-visible:ring-[#1f3a5f] focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </section>
  );
}
