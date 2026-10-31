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
          {/* DocQ&A custom logo */}
          <span className="flex h-8 w-8 items-center justify-center rounded-lg shadow-sm overflow-hidden">
            <svg viewBox="0 0 512 512" className="h-8 w-8" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="hdr-bg" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#4f46e5"/>
                  <stop offset="50%" stopColor="#7c3aed"/>
                  <stop offset="100%" stopColor="#a855f7"/>
                </linearGradient>
              </defs>
              <rect x="16" y="16" width="480" height="480" rx="96" ry="96" fill="url(#hdr-bg)"/>
              {/* Document page */}
              <path d="M152 96L320 96L368 144L368 416L152 416Z" fill="#fff" opacity={0.95}/>
              <path d="M320 96L368 144L320 144Z" fill="#c7d2fe" opacity={0.8}/>
              {/* Text lines */}
              <rect x="180" y="168" width="148" height="8" rx="4" fill="#a5b4fc" opacity={0.6}/>
              <rect x="180" y="192" width="120" height="8" rx="4" fill="#a5b4fc" opacity={0.5}/>
              <rect x="180" y="216" width="156" height="8" rx="4" fill="#a5b4fc" opacity={0.6}/>
              <rect x="180" y="240" width="100" height="8" rx="4" fill="#a5b4fc" opacity={0.4}/>
              <rect x="180" y="264" width="140" height="8" rx="4" fill="#a5b4fc" opacity={0.55}/>
              {/* Highlighted line */}
              <rect x="176" y="290" width="164" height="16" rx="4" fill="#fbbf24" opacity={0.3}/>
              <rect x="180" y="294" width="156" height="8" rx="4" fill="#f59e0b" opacity={0.9}/>
              <rect x="180" y="320" width="130" height="8" rx="4" fill="#a5b4fc" opacity={0.5}/>
              <rect x="180" y="344" width="148" height="8" rx="4" fill="#a5b4fc" opacity={0.45}/>
              <rect x="180" y="368" width="110" height="8" rx="4" fill="#a5b4fc" opacity={0.4}/>
              {/* Neural connections */}
              <g stroke="#c084fc" strokeWidth="2.5" opacity={0.7}>
                <line x1="340" y1="200" x2="388" y2="168"/><line x1="340" y1="200" x2="400" y2="224"/>
                <line x1="340" y1="200" x2="372" y2="256"/><line x1="388" y1="168" x2="424" y2="132"/>
                <line x1="388" y1="168" x2="432" y2="196"/><line x1="400" y1="224" x2="432" y2="196"/>
                <line x1="400" y1="224" x2="440" y2="260"/><line x1="372" y1="256" x2="440" y2="260"/>
                <line x1="372" y1="256" x2="396" y2="312"/><line x1="396" y1="312" x2="440" y2="260"/>
                <line x1="396" y1="312" x2="360" y2="360"/><line x1="396" y1="312" x2="436" y2="340"/>
                <line x1="436" y1="340" x2="440" y2="260"/><line x1="360" y1="360" x2="436" y2="340"/>
              </g>
              {/* Neural nodes */}
              <circle cx="340" cy="200" r="10" fill="#e0e7ff" stroke="#818cf8" strokeWidth="2"/>
              <circle cx="388" cy="168" r="7" fill="#c7d2fe" stroke="#a78bfa" strokeWidth="1.5"/>
              <circle cx="400" cy="224" r="7" fill="#c7d2fe" stroke="#a78bfa" strokeWidth="1.5"/>
              <circle cx="372" cy="256" r="8" fill="#ddd6fe" stroke="#8b5cf6" strokeWidth="1.5"/>
              <circle cx="432" cy="196" r="6" fill="#ede9fe" stroke="#a78bfa" strokeWidth="1.5"/>
              <circle cx="424" cy="132" r="5" fill="#f5f3ff" stroke="#c4b5fd" strokeWidth="1"/>
              <circle cx="440" cy="260" r="7" fill="#c7d2fe" stroke="#a78bfa" strokeWidth="1.5"/>
              <circle cx="396" cy="312" r="8" fill="#ddd6fe" stroke="#8b5cf6" strokeWidth="1.5"/>
              <circle cx="360" cy="360" r="6" fill="#ede9fe" stroke="#a78bfa" strokeWidth="1.5"/>
              <circle cx="436" cy="340" r="5" fill="#f5f3ff" stroke="#c4b5fd" strokeWidth="1"/>
              {/* Magnifying glass */}
              <g transform="translate(108, 280)">
                <circle cx="0" cy="0" r="44" fill="none" stroke="#fff" strokeWidth="7" opacity={0.9}/>
                <circle cx="0" cy="0" r="44" fill="none" stroke="#fbbf24" strokeWidth="4" opacity={0.6}/>
                <line x1="30" y1="30" x2="60" y2="60" stroke="#fff" strokeWidth="7" strokeLinecap="round" opacity={0.9}/>
                <line x1="30" y1="30" x2="60" y2="60" stroke="#fbbf24" strokeWidth="4" strokeLinecap="round" opacity={0.6}/>
                <circle cx="-8" cy="-12" r="3" fill="#fbbf24" opacity={0.8}/>
                <circle cx="10" cy="-4" r="2" fill="#fde68a" opacity={0.6}/>
              </g>
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
