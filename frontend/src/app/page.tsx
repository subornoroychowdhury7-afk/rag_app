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
  getUserFromToken,
  logout,
  type AuthUser,
} from "@/lib/api";
import { AUTH_CHANGED_EVENT } from "@/lib/auth";

export default function Home() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  /* ---- Restore saved session on first load ---- */
  useEffect(() => {
    const token = getToken();
    if (!token) {
      setAuthChecked(true);
      return;
    }

    // Quick initial populate from token so UI renders fast
    const quickUser = getUserFromToken(token);
    if (quickUser) {
      setUser(quickUser);
    }

    getMe()
      .then((res) => {
        if (res?.user) {
          setUser(res.user);
        }
      })
      .catch((err) => {
        console.warn("Could not verify session with /auth/me:", err);
        // If token has expired or is invalid, clear it
        if (!quickUser) {
          logout();
          setUser(null);
        }
      })
      .finally(() => setAuthChecked(true));
  }, []);

  /* ---- Listen for auth expiration or manual change ---- */
  useEffect(() => {
    const onAuthReset = () => {
      const token = getToken();
      if (!token) {
        setUser(null);
        setDocs([]);
        setSidebarOpen(false);
      } else {
        const u = getUserFromToken(token);
        if (u) setUser(u);
      }
    };

    window.addEventListener(AUTH_EXPIRED_EVENT, onAuthReset);
    window.addEventListener("auth:unauthorized", onAuthReset);
    window.addEventListener(AUTH_CHANGED_EVENT, onAuthReset);
    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, onAuthReset);
      window.removeEventListener("auth:unauthorized", onAuthReset);
      window.removeEventListener(AUTH_CHANGED_EVENT, onAuthReset);
    };
  }, []);

  /* ---- Load user documents whenever logged in ---- */
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getDocuments()
      .then((list) => {
        if (!cancelled && Array.isArray(list)) setDocs(list);
      })
      .catch((err) => {
        console.error("Failed to fetch documents:", err);
      });
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
