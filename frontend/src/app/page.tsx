"use client";

import { useEffect, useState } from "react";
import AuthModal, { type AuthModalMode } from "@/components/AuthModal";
import Chat from "@/components/Chat";
import Header from "@/components/Header";
import LandingView from "@/components/LandingView";
import Sidebar, { type Doc } from "@/components/Sidebar";
import SummaryModal from "@/components/SummaryModal";
import { getDocuments, uploadFile } from "@/lib/api";
import {
  clearStoredAuth,
  consumePostAuthView,
  getAuthLoginUrl,
  getAuthLogoutUrl,
  getStoredAuth,
  isExternalAuthEnabled,
  savePostAuthView,
  saveStoredAuth,
  verifySsoToken,
  type AuthSession,
} from "@/lib/auth";

export default function Home() {
  const externalAuth = isExternalAuthEnabled();

  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<AuthModalMode>("login");
  const [authRedirectTarget, setAuthRedirectTarget] = useState<"app" | "landing">("landing");
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
    const controller = new AbortController();
    const url = new URL(window.location.href);
    const ssoToken = url.searchParams.get("sso");

    if (ssoToken && externalAuth) {
      queueMicrotask(() => {
        setAuthVerifying(true);
        setAuthError(null);
        setAuthModalOpen(true);
      });

      verifySsoToken(ssoToken, controller.signal)
        .then((session) => {
          saveStoredAuth(session);
          setAuthSession(session);
          setAuthVerifying(false);
          setAuthModalOpen(false);
          const nextView = consumePostAuthView();
          if (nextView === "app") {
            setView("app");
          }
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
          setAuthModalMode("gate");
          setAuthModalOpen(true);
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
    });

    return () => {
      controller.abort();
    };
  }, [externalAuth]);

  /* ---- Load documents once authorized ---- */
  useEffect(() => {
    if (!authSession) return;

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
  }, [authSession]);

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

  function handleOpenAuth(tab: "login" | "register", targetView: "app" | "landing" = "landing") {
    if (externalAuth) {
      savePostAuthView(targetView);
      window.location.href = getAuthLoginUrl(tab);
      return;
    }
    setAuthError(null);
    setAuthRedirectTarget(targetView);
    setAuthModalMode(tab);
    setAuthModalOpen(true);
  }

  function promptWorkspaceAuth() {
    setAuthError(null);
    setAuthRedirectTarget("app");
    setAuthModalMode("gate");
    setAuthModalOpen(true);
  }

  function handleLocalAuthenticated(session: AuthSession) {
    saveStoredAuth(session);
    setAuthSession(session);
    setAuthModalOpen(false);
    if (authRedirectTarget === "app") {
      setView("app");
    }
  }

  function handleLogout() {
    const token = authSession?.logoutToken;
    clearStoredAuth();
    setAuthSession(null);
    setView("landing");
    if (externalAuth) {
      window.location.href = getAuthLogoutUrl(token);
    }
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
    if (!authSession) {
      promptWorkspaceAuth();
      return;
    }
    const res = await uploadFile(file);
    const newDoc: Doc = { name: res.filename, chunks: res.chunks_processed };
    handleUploaded(newDoc);
    setView("app");
  }

  /* ---- Workspace entry guard ---- */
  function handleEnterWorkspace() {
    if (!authSession) {
      promptWorkspaceAuth();
      return;
    }
    setView("app");
  }

  function handleToggleView() {
    if (view === "landing") {
      handleEnterWorkspace();
    } else {
      setView("landing");
    }
  }

  const effectiveView = authSession ? view : "landing";

  return (
    <div className="flex h-dvh flex-col">
      <Header
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((p) => !p)}
        darkMode={darkMode}
        onToggleDark={toggleDark}
        currentView={effectiveView}
        onToggleView={handleToggleView}
        docsCount={docs.length}
        authUser={authSession?.user ?? null}
        onOpenLogin={() => handleOpenAuth("login", "landing")}
        onOpenRegister={() => handleOpenAuth("register", "landing")}
        onLogout={authSession ? handleLogout : undefined}
      />

      {effectiveView === "landing" ? (
        <div className="flex-1 overflow-y-auto">
          <LandingView
            onGetStarted={handleEnterWorkspace}
            onUploadFile={handleLandingUpload}
            docsCount={docs.length}
            isAuthenticated={Boolean(authSession)}
            onRequireAuth={promptWorkspaceAuth}
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

      {/* Auth prompt / Sign-In / Register modal */}
      <AuthModal
        open={authModalOpen}
        mode={authModalMode}
        verifying={authVerifying}
        error={authError}
        redirectAfterAuth={authRedirectTarget}
        onClose={() => {
          if (!authVerifying) setAuthModalOpen(false);
        }}
        onSwitchMode={(nextMode) => setAuthModalMode(nextMode)}
        onAuthenticated={handleLocalAuthenticated}
      />

      {/* AI Executive Summary Briefing Modal */}
      {authSession && (
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
