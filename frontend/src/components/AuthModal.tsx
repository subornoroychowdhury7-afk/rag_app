"use client";

import { useState, type FormEvent } from "react";
import Spinner from "./Spinner";
import {
  getAuthLoginUrl,
  isExternalAuthEnabled,
  loginLocalUser,
  registerLocalUser,
  savePostAuthView,
  type AuthSession,
} from "@/lib/auth";

export type AuthModalMode = "gate" | "login" | "register";

interface AuthModalProps {
  open: boolean;
  mode: AuthModalMode;
  verifying?: boolean;
  error?: string | null;
  redirectAfterAuth?: "app" | "landing";
  onClose: () => void;
  onSwitchMode: (mode: "login" | "register") => void;
  onAuthenticated: (session: AuthSession) => void;
}

export default function AuthModal({
  open,
  mode,
  verifying = false,
  error = null,
  redirectAfterAuth = "landing",
  onClose,
  onSwitchMode,
  onAuthenticated,
}: AuthModalProps) {
  const externalAuth = isExternalAuthEnabled();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localSuccess, setLocalSuccess] = useState<string | null>(null);

  if (!open) return null;

  function goToExternalAuth(tab: "login" | "register") {
    savePostAuthView(redirectAfterAuth);
    window.location.href = getAuthLoginUrl(tab);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);
    setLocalSuccess(null);
    setSubmitting(true);

    try {
      if (mode === "register") {
        await registerLocalUser({ name, email, password, role });
        setLocalSuccess("Account created! You can now log in.");
        setPassword("");
        onSwitchMode("login");
      } else {
        const session = await loginLocalUser(email, password);
        setPassword("");
        onAuthenticated(session);
      }
    } catch (err) {
      setLocalError(
        err instanceof Error ? err.message : "Authentication failed."
      );
    } finally {
      setSubmitting(false);
    }
  }

  const displayError = error || localError;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          aria-label="Close authentication modal"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/25">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        </div>

        {verifying ? (
          <div className="py-6 text-center">
            <div className="flex items-center justify-center gap-2.5 text-sm font-medium text-slate-700 dark:text-slate-200">
              <Spinner className="h-4 w-4 text-indigo-600" />
              <span>Verifying your signed session…</span>
            </div>
          </div>
        ) : mode === "gate" ? (
          <div className="text-center">
            <h2
              id="auth-modal-title"
              className="text-xl font-bold text-slate-900 dark:text-white"
            >
              Login or Register First
            </h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              Please sign in or create an account before accessing the DocQ&amp;A Workspace.
            </p>

            {displayError && (
              <div
                role="alert"
                className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-left text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
              >
                {displayError}
              </div>
            )}

            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() =>
                  externalAuth ? goToExternalAuth("login") : onSwitchMode("login")
                }
                className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                Login
              </button>
              <button
                type="button"
                onClick={() =>
                  externalAuth
                    ? goToExternalAuth("register")
                    : onSwitchMode("register")
                }
                className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-500/20 transition hover:opacity-95"
              >
                Register
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="text-center">
              <h2
                id="auth-modal-title"
                className="text-xl font-bold text-slate-900 dark:text-white"
              >
                {mode === "register" ? "Create Account" : "Sign In to DocQ&A"}
              </h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {mode === "register"
                  ? "Register to unlock document indexing & AI workspace chat"
                  : "Sign in with your account to access the Workspace"}
              </p>
            </div>

            {/* Login / Register Toggle */}
            <div className="mt-5 grid grid-cols-2 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => {
                  setLocalError(null);
                  onSwitchMode("login");
                }}
                className={`rounded-lg py-1.5 text-xs font-semibold transition ${
                  mode === "login"
                    ? "bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                }`}
              >
                Login
              </button>
              <button
                type="button"
                onClick={() => {
                  setLocalError(null);
                  setLocalSuccess(null);
                  onSwitchMode("register");
                }}
                className={`rounded-lg py-1.5 text-xs font-semibold transition ${
                  mode === "register"
                    ? "bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                }`}
              >
                Register
              </button>
            </div>

            {localSuccess && (
              <div
                role="status"
                className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
              >
                {localSuccess}
              </div>
            )}

            {displayError && (
              <div
                role="alert"
                className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
              >
                {displayError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
              {mode === "register" && (
                <div>
                  <label
                    htmlFor="modal-name"
                    className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Full name
                  </label>
                  <input
                    id="modal-name"
                    type="text"
                    required
                    minLength={2}
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jane Doe"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 outline-hidden transition focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              )}

              <div>
                <label
                  htmlFor="modal-email"
                  className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Email address
                </label>
                <input
                  id="modal-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 outline-hidden transition focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div>
                <label
                  htmlFor="modal-password"
                  className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Password
                </label>
                <div className="relative">
                  <input
                    id="modal-password"
                    type={showPw ? "text" : "password"}
                    required
                    minLength={mode === "register" ? 8 : 1}
                    maxLength={72}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={
                      mode === "register"
                        ? "8+ chars, A-Z, a-z, 0-9, symbol"
                        : "Enter your password"
                    }
                    className="w-full rounded-xl border border-slate-200 bg-white py-2 pr-14 pl-3.5 text-sm text-slate-900 outline-hidden transition focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((p) => !p)}
                    className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                  >
                    {showPw ? "Hide" : "Show"}
                  </button>
                </div>
              </div>

              {mode === "register" && (
                <div>
                  <label
                    htmlFor="modal-role"
                    className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Account role
                  </label>
                  <select
                    id="modal-role"
                    value={role}
                    onChange={(e) =>
                      setRole(e.target.value === "admin" ? "admin" : "user")
                    }
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 outline-hidden transition focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-500/20 transition hover:opacity-95 disabled:opacity-60"
              >
                {submitting && <Spinner className="h-4 w-4 text-white" />}
                <span>
                  {mode === "register" ? "Create Account" : "Sign In"}
                </span>
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
