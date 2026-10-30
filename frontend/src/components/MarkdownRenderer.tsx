"use client";

import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

interface MarkdownRendererProps {
  content: string;
}

function PreBlock({ children }: { children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  function copyCode() {
    if (preRef.current) {
      navigator.clipboard.writeText(preRef.current.innerText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="group relative my-3">
      <button
        onClick={copyCode}
        className="absolute right-2.5 top-2.5 z-10 rounded-md border border-slate-700/80 bg-slate-800/80 px-2 py-1 text-xs text-slate-300 opacity-0 shadow-xs backdrop-blur-xs transition hover:bg-slate-700 hover:text-white group-hover:opacity-100"
        title="Copy code snippet"
      >
        {copied ? "✓ Copied" : "Copy"}
      </button>
      <pre
        ref={preRef}
        className="overflow-x-auto rounded-xl border border-slate-800/80 bg-slate-900/95 p-4 font-mono text-xs leading-relaxed text-slate-100 shadow-xs dark:bg-black/90"
      >
        {children}
      </pre>
    </div>
  );
}

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="prose-sm max-w-none">
      {/*
        katex/dist/katex.min.css is imported globally in layout.tsx.
        This style tag handles display-math overflow on narrow screens so
        wide matrices/equations scroll horizontally instead of breaking out.
      */}
      <style>{`.katex-display { overflow-x: auto; overflow-y: hidden; padding-bottom: 4px; }`}</style>

      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[[rehypeKatex, { strict: false, trust: false }]]}
        components={{
          h1: ({ children }) => (
            <h1 className="mb-3 mt-4 text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 first:mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2.5 mt-3.5 border-b border-slate-200/60 pb-1 text-lg font-semibold tracking-tight text-slate-800 dark:border-slate-700/60 dark:text-slate-200 first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-2 mt-3 text-base font-semibold text-slate-800 dark:text-slate-200 first:mt-0">{children}</h3>
          ),
          p: ({ children }) => <p className="mb-2.5 leading-relaxed text-slate-700 dark:text-slate-300 last:mb-0">{children}</p>,
          ul: ({ children }) => (
            <ul className="mb-3 ml-4 list-disc space-y-1 text-slate-700 dark:text-slate-300 last:mb-0">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-3 ml-4 list-decimal space-y-1 text-slate-700 dark:text-slate-300 last:mb-0">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-slate-900 dark:text-slate-100">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-4 border-indigo-400 bg-indigo-50/50 py-1.5 pl-4 pr-3 italic text-slate-700 dark:border-indigo-500 dark:bg-indigo-950/20 dark:text-slate-300 rounded-r-lg">
              {children}
            </blockquote>
          ),
          pre: ({ children }) => <PreBlock>{children}</PreBlock>,
          code: ({ className, children }) => {
            const isBlock = className && /language-/.test(className);
            if (isBlock) {
              return <code className={`${className} font-mono`}>{children}</code>;
            }
            return (
              <code className="rounded-md bg-indigo-50/80 px-1.5 py-0.5 font-mono text-xs font-semibold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-900/40">
                {children}
              </code>
            );
          },
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-600 underline underline-offset-2 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300"
            >
              {children}
            </a>
          ),
          hr: () => <hr className="my-4 border-slate-200 dark:border-slate-700" />,
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-xl border border-slate-200 shadow-2xs dark:border-slate-700">
              <table className="min-w-full border-collapse text-left text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-slate-200 bg-slate-100/90 px-3.5 py-2.5 font-semibold text-slate-900 dark:border-slate-700 dark:bg-slate-800/90 dark:text-slate-100">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-slate-100 px-3.5 py-2.5 text-slate-700 dark:border-slate-800 dark:text-slate-300">
              {children}
            </td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
