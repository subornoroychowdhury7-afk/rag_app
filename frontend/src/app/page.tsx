"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Auth from "@/components/Auth";
import Chat from "@/components/Chat";
import Header from "@/components/Header";
import Sidebar, { type Doc } from "@/components/Sidebar";
import { getDocuments } from "@/lib/api";
import {
  clearAuthSession,
  getAuthEmailSnapshot,
  subscribeAuthSession,
} from "@/lib/auth";
import { getDarkModeSnapshot, setDarkMode, subscribeTheme } from "@/lib/theme";

export default function Home() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const userEmail = useSyncExternalStore(subscribeAuthSession, getAuthEmailSnapshot, () => null);
  const darkMode = useSyncExternalStore(subscribeTheme, getDarkModeSnapshot, () => false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const handleUnauthorized = () => {
      setDocs([]);
    };
    window.addEventListener("auth:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("auth:unauthorized", handleUnauthorized);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  useEffect(() => {
    if (!userEmail) return;
    getDocuments()
      .then(setDocs)
      .catch((error: unknown) => {
        if (!(error instanceof Error) || !error.message.includes("Authentication")) {
          console.error(error);
        }
      });
  }, [userEmail]);

  function toggleDark() {
    setDarkMode(!darkMode);
  }

  function handleUploaded(d: Doc) {
    setDocs((prev) => [...prev.filter((x) => x.name !== d.name), d]);
    setSidebarOpen(false); // close sidebar on mobile after upload
  }

  function handleDeleted(name: string) {
    setDocs((prev) => prev.filter((x) => x.name !== name));
  }

  function handleSignOut() {
    clearAuthSession();
    setDocs([]);
  }

  if (!userEmail) return <Auth />;

  return (
    <div className="flex h-dvh flex-col">
      <Header
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((p) => !p)}
        darkMode={darkMode}
        onToggleDark={toggleDark}
        userEmail={userEmail}
        onSignOut={handleSignOut}
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
