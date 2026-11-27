"use client";

import { useEffect, useState } from "react";
import AuthGate from "@/components/AuthGate";
import Chat from "@/components/Chat";
import Header from "@/components/Header";
import LandingView from "@/components/LandingView";
import Sidebar, { type Doc } from "@/components/Sidebar";
import SummaryModal from "@/components/SummaryModal";
import { getDocuments, uploadFile } from "@/lib/api";
import {
  clearStoredAuth,
  getAuthLogoutUrl,
  getStoredAuth,
  isAuthEnabled,
  saveStoredAuth,
  verifySsoToken,
  type AuthSession,
} from "@/lib/auth";

export default function Home() {
  const authEnabled = isAuthEnabled();

  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [authChecked, setAuthChecked] = useState(!authEnabled);
  const [authVerifying, setAuthVerifying] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [docs, setDocs] = useState<Doc[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [selectedDocFilter, setSelectedDocFilter] = useState<string | null>(null);
  const [summaryDocFilename, setSummaryDocFilename] = useState<string | null>(null);
  const [view, setView] = useState<"landing" | "app">("landing");

  /* ---- Resolve SSO token or stored session on mount ---- */
  useEffect(() => {
    if (!authEnabled) return;

    const controller = new AbortController();
    const url = new URL(window.location.href);
    const ssoToken = url.searchParams.get("sso");

    if (ssoToken) {
      queueMicrotask(() => {
        setAuthVerifying(true);
        setAuthError(null);
      });

      verifySsoToken(ssoToken, controller.signal)
        .then((session) => {
          saveStoredAuth(session);
          setAuthSession(session);
          setAuthVerifying(false);
          setAuthChecked(true);
          url.searchParams.delete("sso");
          window.history.replaceState({}, "", url.pathname + url.search + url.hash);
        })
        .catch((err) => {
          if (err instanceof Error && err.name === "AbortError") return;
          clearStoredAuth();
          setAuthError(
            err instanceof Error
              ? err.message
              : "Could not verify SSO login token."
          );
          setAuthVerifying(false);
          setAuthChecked(true);
          url.searchParams.delete("sso");
          window.history.replaceState({}, "", url.pathname + url.search + url.hash);
        });

      return () => {
        controller.abort();
      };
    }

    const existing = getStoredAuth();
    queueMicrotask(() => {
      if (existing) {
        setAuthSession(existing);
      }
      setAuthChecked(true);
    });

    return () => {
      controller.abort();
    };
  }, [authEnabled]);

  /* ---- Load documents once authorized ---- */
  useEffect(() => {
    if (authEnabled && !authSession) return;

    const controller = new AbortController();
    getDocuments(controller.signal)
      .then((list) => {
        if (Array.isArray(list)) {
          setDocs(list);
        }
      })
      .catch((err) => {
        if (err instanceof Error && err.name === "AbortError") return;
        console.error("Failed to fetch documents:", err);
      });
    return () => {
      controller.abort();
    };
  }, [authEnabled, authSession]);

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

  function handleLogout() {
    const logoutUrl = getAuthLogoutUrl(authSession?.logoutToken);
    clearStoredAuth();
    setAuthSession(null);
    window.location.href = logoutUrl;
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

  const isLocked = authEnabled && !authSession;

  return (
    <div className="flex h-dvh flex-col">
      <Header
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((p) => !p)}
        darkMode={darkMode}
        onToggleDark={toggleDark}
        currentView={isLocked ? "landing" : view}
        onToggleView={
          isLocked
            ? undefined
            : () => setView((v) => (v === "landing" ? "app" : "landing"))
        }
        docsCount={docs.length}
        authUser={authSession?.user ?? null}
        onLogout={authEnabled && authSession ? handleLogout : undefined}
      />

      {isLocked ? (
        <AuthGate
          verifying={!authChecked || authVerifying}
          error={authError}
        />
      ) : view === "landing" ? (
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
      {!isLocked && (
        <SummaryModal
          filename={summaryDocFilename}
          onClose={() => setSummaryDocFilename(null)}
          onAskAboutDoc={(docName) => {
            setSelectedDocFilter(docName);
          }}
        />
      )}
    </div>
  );
}
