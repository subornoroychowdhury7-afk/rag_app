"use client";

import Spinner from "./Spinner";
import { getAuthLoginUrl } from "@/lib/auth";

interface AuthGateProps {
  verifying: boolean;
  error: string | null;
}

export default function AuthGate({ verifying, error }: AuthGateProps) {
  const loginUrl = getAuthLoginUrl();

  return (
    <main className="flex min-h-0 flex-1 items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-500/25">
          <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        </div>

        <div className="text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300">
            SecureAuth SSO Protected
          </span>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Sign in to DocQ&amp;A
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Authenticate through the SecureAuth Portal to access document indexing, grounded citations, and AI briefings.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
          >
            {error}
          </div>
        )}

        <div className="mt-6">
          {verifying ? (
            <div className="flex items-center justify-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
              <Spinner className="h-4 w-4 text-indigo-600" />
              <span>Verifying signed SSO session…</span>
            </div>
          ) : (
            <a
              href={loginUrl}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-3 text-sm font-semibold text-white shadow-md shadow-indigo-500/20 transition hover:opacity-95"
            >
              <span>Sign In / Register via Auth Portal</span>
              <span aria-hidden="true">→</span>
            </a>
          )}
        </div>

        <div className="mt-6 grid grid-cols-2 gap-2.5 border-t border-slate-200 pt-5 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
            <strong className="block text-slate-700 dark:text-slate-200">HMAC-SHA256 SSO</strong>
            120s signed handoff
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
            <strong className="block text-slate-700 dark:text-slate-200">bcrypt + Rate Limit</strong>
            Hardened MariaDB auth
          </div>
        </div>
      </div>
    </main>
  );
}
