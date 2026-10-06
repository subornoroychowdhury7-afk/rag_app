"use client";

import ReactMarkdown from "react-markdown";

interface MarkdownRendererProps {
  content: string;
}

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="prose-sm max-w-none">
      <ReactMarkdown
        components={{
          h1: ({ children }) => (
            <h1 className="mb-3 mt-4 text-xl font-bold first:mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2 mt-3 text-lg font-semibold first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-2 mt-3 text-base font-semibold first:mt-0">{children}</h3>
          ),
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          ul: ({ children }) => (
            <ul className="mb-2 ml-4 list-disc space-y-1 last:mb-0">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-2 ml-4 list-decimal space-y-1 last:mb-0">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-4 border-indigo-300 pl-4 italic text-slate-600 dark:border-indigo-500 dark:text-slate-400">
              {children}
            </blockquote>
          ),
          pre: ({ children }) => (
            <div className="group relative my-2">
              <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 font-mono text-sm leading-relaxed text-slate-100 dark:bg-black">
                {children}
              </pre>
            </div>
          ),
          code: ({ className, children }) => {
            const isBlock = className && /language-/.test(className);
            if (isBlock) {
              return <code className={`${className} font-mono`}>{children}</code>;
            }
            return (
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm text-indigo-700 dark:bg-slate-700 dark:text-indigo-300">
                {children}
              </code>
            );
          },
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-600 underline hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300"
            >
              {children}
            </a>
          ),
          hr: () => <hr className="my-4 border-slate-200 dark:border-slate-700" />,
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="min-w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-slate-300 bg-slate-100 px-3 py-2 text-left font-semibold dark:border-slate-600 dark:bg-slate-800">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-slate-300 px-3 py-2 dark:border-slate-600">
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
