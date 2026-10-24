"use client";

import { useEffect, useRef, useState } from "react";
import Chat from "@/components/Chat";
import Header from "@/components/Header";
import LandingView from "@/components/LandingView";
import Sidebar, { type Doc } from "@/components/Sidebar";
import SummaryModal from "@/components/SummaryModal";
import { getDocuments, uploadFile } from "@/lib/api";

export default function Home() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [selectedDocFilter, setSelectedDocFilter] = useState<string | null>(null);
  const [summaryDocFilename, setSummaryDocFilename] = useState<string | null>(null);
  const [view, setView] = useState<"landing" | "app">("landing");

  const pageFileInputRef = useRef<HTMLInputElement>(null);

  /* ---- Load documents on mount ---- */
  useEffect(() => {
    let cancelled = false;
    getDocuments()
      .then((list) => {
        if (!cancelled && Array.isArray(list)) {
          setDocs(list);
        }
      })
      .catch((err) => {
        console.error("Failed to fetch documents:", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---- Dark mode: localStorage + system preference on mount ---- */
  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (stored === "dark" || (!stored && prefersDark)) {
      queueMicrotask(() => {
        setDarkMode(true);
        document.documentElement.classList.add("dark");
      });
    }
  }, []);

  function toggleDark() {
    setDarkMode((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("dark", next);
      localStorage.setItem("theme", next ? "dark" : "light");
      return next;
    });
  }

  function handleUploaded(d: Doc) {
    setDocs((prev) => [...prev.filter((x) => x.name !== d.name), d]);
    setSidebarOpen(false); // close sidebar on mobile after upload
  }

  function handleDeleted(name: string) {
    setDocs((prev) => prev.filter((x) => x.name !== name));
    if (selectedDocFilter === name) {
      setSelectedDocFilter(null);
    }
    if (summaryDocFilename === name) {
      setSummaryDocFilename(null);
    }
  }

  /* ---- Handle Direct Upload from Landing Page ---- */
  async function handleLandingUpload(file: File) {
    const res = await uploadFile(file);
    const newDoc: Doc = { name: res.filename, chunks: res.chunks_processed };
    handleUploaded(newDoc);
    setView("app");
  }

  /* ---- "Get Started" Action ---- */
  function handleGetStarted() {
    setView("app");
  }

  return (
    <div className="flex h-dvh flex-col">
      <Header
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((p) => !p)}
        darkMode={darkMode}
        onToggleDark={toggleDark}
        currentView={view}
        onToggleView={() => setView((v) => (v === "landing" ? "app" : "landing"))}
        docsCount={docs.length}
      />

      {/* Hidden file input for header/landing quick upload triggers */}
      <input
        ref={pageFileInputRef}
        type="file"
        accept=".pdf,.txt,.md,.markdown,text/plain,text/markdown,application/pdf"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            handleLandingUpload(file).catch(console.error);
          }
        }}
      />

      {view === "landing" ? (
        <div className="flex-1 overflow-y-auto">
          <LandingView
            onGetStarted={handleGetStarted}
            onUploadFile={handleLandingUpload}
            docsCount={docs.length}
          />
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          {/* Mobile backdrop */}
          {sidebarOpen && (
            <div
              className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm transition-opacity md:hidden"
              onClick={() => setSidebarOpen(false)}
            />
          )}
          <Sidebar
            isOpen={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            docs={docs}
            onUploaded={handleUploaded}
            onDeleted={handleDeleted}
            onSummarize={(name) => setSummaryDocFilename(name)}
            selectedDocFilter={selectedDocFilter}
            onSelectDocFilter={setSelectedDocFilter}
          />
          <Chat
            hasDocs={docs.length > 0}
            selectedDocFilter={selectedDocFilter}
            onSelectDocFilter={setSelectedDocFilter}
          />
        </div>
      )}

      {/* AI Executive Summary Briefing Modal */}
      <SummaryModal
        filename={summaryDocFilename}
        onClose={() => setSummaryDocFilename(null)}
        onAskAboutDoc={(docName) => {
          setSelectedDocFilter(docName);
        }}
      />
    </div>
  );
}
