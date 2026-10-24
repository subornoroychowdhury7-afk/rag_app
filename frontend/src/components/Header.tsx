"use client";

interface HeaderProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  darkMode: boolean;
  onToggleDark: () => void;
  currentView?: "landing" | "app";
  onToggleView?: () => void;
  docsCount?: number;
}

export default function Header({
  sidebarOpen,
  onToggleSidebar,
  darkMode,
  onToggleDark,
  currentView = "app",
  onToggleView,
  docsCount = 0,
}: HeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white/80 px-4 backdrop-blur-lg dark:border-slate-700/50 dark:bg-slate-900/80">
      <div className="flex items-center gap-3">
        {/* Mobile sidebar toggle (only shown in app view) */}
        {currentView === "app" && (
          <button
            onClick={onToggleSidebar}
            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 md:hidden"
            aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
          >
            {sidebarOpen ? (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        )}

        {/* Logo - clickable to toggle view */}
        <button
          onClick={onToggleView}
          className="flex items-center gap-2 text-left focus:outline-hidden"
          title={currentView === "app" ? "View Product Guide & Architecture" : "Go to Workspace"}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-tr from-indigo-600 to-violet-600 text-white shadow-xs">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </span>
          <span className="text-lg font-bold tracking-tight bg-gradient-to-r from-indigo-500 to-violet-600 bg-clip-text text-transparent">
            DocQ&amp;A
          </span>
        </button>
      </div>

      <div className="flex items-center gap-2">
        {/* Toggle between Guide/Verification and App view */}
        {onToggleView && (
          <button
            onClick={onToggleView}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white/70 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs transition hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            {currentView === "app" ? (
              <>
                <svg className="h-3.5 w-3.5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Product Guide &amp; Proof</span>
              </>
            ) : (
              <>
                <span>Workspace</span>
                {docsCount > 0 && (
                  <span className="rounded-full bg-indigo-100 px-1.5 py-0.2 text-[10px] font-bold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                    {docsCount}
                  </span>
                )}
                <span>→</span>
              </>
            )}
          </button>
        )}

        {/* Dark mode toggle */}
        <button
          onClick={onToggleDark}
          className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
        >
          {darkMode ? (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
              />
            </svg>
          ) : (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
              />
            </svg>
          )}
        </button>
      </div>
    </header>
  );
}
