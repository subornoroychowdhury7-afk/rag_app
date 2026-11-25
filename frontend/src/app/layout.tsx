import type { Metadata } from "next";
import "./globals.css";
import "katex/dist/katex.min.css";

export const metadata: Metadata = {
  title: "Vyrex AI — Agentic RAG powered by LangGraph & MCP",
  description:
    "Enterprise-grade Agentic RAG powered by LangGraph and the Model Context Protocol (MCP). Zero hallucinations, deep chain-of-thought verification, and grounded citations.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
