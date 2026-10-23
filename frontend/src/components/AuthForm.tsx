"use client";

import { useState, type FormEvent } from "react";
import { login, register, type AuthUser } from "@/lib/api";
import Spinner from "./Spinner";

type AuthMethod = "password" | "register";

const MIN_PASSWORD = 8;

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500";

export default function AuthForm({ onAuthed }: { onAuthed: (user: AuthUser) => void }) {
  const [method, setMethod] = useState<AuthMethod>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function switchMethod(next: AuthMethod) {
    setMethod(next);
    setError(null);
    setPassword("");
    setConfirm("");
  }

  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      setError("Please enter your email and password.");
      return;
    }
    if (method === "register") {
      if (password.length < MIN_PASSWORD) {
        setError(`Password must be at least ${MIN_PASSWORD} characters.`);
        return;
      }
      if (password !== confirm) {
        setError("Passwords do not match.");
        return;
      }
    }

    setBusy(true);
    try {
      const res =
        method === "register"
          ? await register(cleanEmail, password)
          : await login(cleanEmail, password);

      onAuthed(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed. Please check your credentials.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh bg-white dark:bg-slate-950 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(460px,0.82fr)]">
      <section className="relative hidden min-h-dvh overflow-hidden bg-[#11152b] px-12 py-10 text-white lg:flex lg:flex-col lg:justify-between xl:px-20">
        <div className="absolute -right-32 -top-32 h-[34rem] w-[34rem] rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="absolute -bottom-48 -left-32 h-[34rem] w-[34rem] rounded-full bg-violet-500/15 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500 shadow-lg shadow-indigo-950/30">
            <svg
              className="h-5 w-5 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 3.75h7l4.25 4.5v12A1.75 1.75 0 0116.5 22h-9A1.75 1.75 0 015.75 20.25v-14A2.5 2.5 0 018.25 3.75M14 4v4.5h4M9 13h6M9 16.5h6" />
            </svg>
          </div>
          <span className="text-lg font-semibold tracking-tight">DocQ&amp;A</span>
        </div>

        <div className="relative my-14 max-w-xl xl:ml-12">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-2 text-xs font-medium text-indigo-100">
            <span className="h-2 w-2 rounded-full bg-emerald-400" /> Your knowledge, in one place
          </div>
          <h2 className="text-4xl font-semibold leading-[1.12] tracking-tight xl:text-5xl">Your documents have answers.</h2>
          <p className="mt-5 max-w-md text-base leading-7 text-slate-300">Bring your files together and get to the information you need with a simple conversation.</p>

          <div className="mt-12 rounded-2xl border border-white/10 bg-white/[0.07] p-5 shadow-2xl shadow-black/20 backdrop-blur-sm">
            <div className="flex items-center gap-3 border-b border-white/10 pb-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-400/15 text-indigo-200">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M7 3.75h7l4.25 4.5v12A1.75 1.75 0 0116.5 22h-9A1.75 1.75 0 015.75 20.25v-14A2.5 2.5 0 018.25 3.75M14 4v4.5h4M9 13h6M9 16.5h4" /></svg>
              </div>
              <div><p className="text-sm font-medium">Project overview.pdf</p><p className="mt-0.5 text-xs text-slate-400">Ready to explore</p></div>
              <span className="ml-auto rounded-full bg-emerald-400/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">Added</span>
            </div>
            <div className="mt-4 max-w-[90%] rounded-xl rounded-tl-sm bg-white/10 px-4 py-3 text-sm leading-6 text-slate-200">What are the key milestones in this document?</div>
            <div className="ml-auto mt-3 max-w-[90%] rounded-xl rounded-tr-sm bg-indigo-500/25 px-4 py-3 text-sm leading-6 text-indigo-50">I found three key milestones. The first is the initial project review…</div>
            <p className="mt-3 text-right text-[11px] text-slate-400">A clearer way to work with your files</p>
          </div>
        </div>
        <p className="relative text-xs text-slate-400">Private access to your documents, whenever you need it.</p>
      </section>

      <section className="flex min-h-dvh flex-col px-5 py-6 sm:px-10 lg:justify-center lg:px-14 xl:px-24">
       <div className="mx-auto w-full max-w-md animate-fade-in-up">
        <div className="mb-10 flex items-center gap-3 lg:hidden">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-md shadow-indigo-600/20">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7 3.75h7l4.25 4.5v12A1.75 1.75 0 0116.5 22h-9A1.75 1.75 0 015.75 20.25v-14A2.5 2.5 0 018.25 3.75M14 4v4.5h4M9 13h6M9 16.5h6" /></svg>
          </div><span className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">DocQ&amp;A</span>
        </div>
        <div className="mb-7">
          <p className="mb-2 text-sm font-medium text-indigo-600 dark:text-indigo-400">{method === "register" ? "Get started" : "Welcome back"}</p>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
            {method === "register" ? "Create your account" : "Sign in to DocQ&A"}
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
            {method === "register" ? "Create an account to keep your documents in one place." : "Enter your details to access your documents."}
          </p>
        </div>

        {/* Method Switcher Tabs */}
        <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300" role="tablist" aria-label="Sign in method">
          <button
            type="button"
            onClick={() => switchMethod("password")}
            className={`rounded-lg py-1.5 transition-all ${
              method === "password"
              ? "bg-white text-indigo-700 shadow-sm dark:bg-slate-700 dark:text-white"
                : "hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            Password
          </button>
          <button
            type="button"
            onClick={() => switchMethod("register")}
            className={`rounded-lg py-1.5 transition-all ${
              method === "register"
              ? "bg-white text-indigo-700 shadow-sm dark:bg-slate-700 dark:text-white"
                : "hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            Register
          </button>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_12px_42px_-22px_rgba(15,23,42,0.22)] sm:p-8 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
          <form onSubmit={handlePasswordSubmit} noValidate className="space-y-4">
            <div>
              <label
                htmlFor="pwd-email"
                className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                Email
              </label>
              <input
                id="pwd-email"
                type="email"
                inputMode="email"
                autoComplete="username"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
                placeholder="you@example.com"
                className={inputClass}
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={method === "register" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                  placeholder={
                    method === "register" ? `At least ${MIN_PASSWORD} characters` : "Your password"
                  }
                  className={`${inputClass} pr-16`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            {method === "register" && (
              <div>
                <label
                  htmlFor="confirm"
                  className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  Confirm password
                </label>
                <input
                  id="confirm"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  disabled={busy}
                  placeholder="Re-enter your password"
                  className={inputClass}
                />
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy && <Spinner className="h-4 w-4" />}
              {busy
                ? method === "register"
                  ? "Creating account…"
                  : "Logging in…"
                : method === "register"
                  ? "Create account"
                  : "Log in"}
            </button>
          </form>

          {/* Feedback alerts */}
          {error && (
            <div
              role="alert"
              className="mt-4 rounded-lg bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300"
            >
              <p>{error}</p>
              {method === "password" && (
                <p className="mt-1.5 text-slate-600 dark:text-slate-400">
                  If this is a new deployment or you haven&apos;t created an account yet,{" "}
                  <button
                    type="button"
                    onClick={() => {
                      switchMethod("register");
                      setConfirm(password);
                    }}
                    className="font-semibold text-indigo-600 underline hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300"
                  >
                    click here to register
                  </button>{" "}
                  with these credentials.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer switch */}
        <p className="mt-5 text-center text-sm text-slate-500 dark:text-slate-400">
          {method === "register" ? (
            <>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => switchMethod("password")}
                className="font-medium text-indigo-700 hover:underline dark:text-indigo-400"
              >
                Sign in
              </button>
            </>
          ) : (
            <>
              New to DocQ&amp;A?{" "}
              <button
                type="button"
                onClick={() => switchMethod("register")}
                className="font-medium text-indigo-700 hover:underline dark:text-indigo-400"
              >
                Create an account
              </button>
            </>
          )}
        </p>
      </div>
    </section>
  </main>
);
}
