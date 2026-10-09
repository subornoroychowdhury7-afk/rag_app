import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DocQ&A — AI Document Assistant",
  description: "Ask questions about your PDFs, answered only from what they say.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
