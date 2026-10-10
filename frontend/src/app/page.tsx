"use client";

import { useEffect, useState } from "react";
import AuthForm from "@/components/AuthForm";
import Chat from "@/components/Chat";
import Header from "@/components/Header";
import Sidebar, { type Doc } from "@/components/Sidebar";
import Spinner from "@/components/Spinner";
import {
  AUTH_EXPIRED_EVENT,
  getDocuments,
  getMe,
  getToken,
  logout,
  type AuthUser,
} from "@/lib/api";

export default function Home() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  /* ---- Restore a saved session on first load ---- */
  useEffect(() => {
    if (!getToken()) {
      setAuthChecked(true);
      return;
    }
    getMe()
      .then((res) => setUser(res.user))
      .catch(() => {
        /* 401 already cleared the token; any other error just shows the login screen */
      })
      .finally(() => setAuthChecked(true));
  }, []);

  /* ---- Session expired while using the app -> back to the login screen ---- */
  useEffect(() => {
    const onExpired = () => {
      setUser(null);
      setDocs([]);
      setSidebarOpen(false);
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  /* ---- Load this user's documents whenever someone logs in ---- */
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getDocuments()
      .then((list) => {
        if (!cancelled) setDocs(list);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [user]);

  /* ---- Dark mode: localStorage + system preference on mount ---- */
  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (stored === "dark" || (!stored && prefersDark)) {
      setDarkMode(true);
      document.documentElement.classList.add("dark");
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
    logout();
    setUser(null);
    setDocs([]);
    setSidebarOpen(false);
  }

  function handleUploaded(d: Doc) {
    setDocs((prev) => [...prev.filter((x) => x.name !== d.name), d]);
    setSidebarOpen(false); // close sidebar on mobile after upload
  }

  function handleDeleted(name: string) {
    setDocs((prev) => prev.filter((x) => x.name !== name));
  }

  if (!authChecked) {
    return (
      <div className="flex h-dvh items-center justify-center bg-slate-50 dark:bg-slate-950">
        <Spinner className="h-8 w-8 text-indigo-500" />
      </div>
    );
  }

  if (!user) {
    return <AuthForm onAuthed={setUser} />;
  }

  return (
    <div className="flex h-dvh flex-col">
      <Header
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((p) => !p)}
        darkMode={darkMode}
        onToggleDark={toggleDark}
        userEmail={user.email}
        onLogout={handleLogout}
      />
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
        />
        <Chat hasDocs={docs.length > 0} />
      </div>
    </div>
  );
}
