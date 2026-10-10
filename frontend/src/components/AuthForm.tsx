"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { login, register, sendOtp, verifyOtp, loginWithGoogle, type AuthUser } from "@/lib/api";
import Spinner from "./Spinner";

type AuthMethod = "otp" | "password" | "register";

const MIN_PASSWORD = 8;
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

const inputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:placeholder:text-slate-500";

export default function AuthForm({ onAuthed }: { onAuthed: (user: AuthUser) => void }) {
  const [method, setMethod] = useState<AuthMethod>("otp");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // OTP state
  const [otpStep, setOtpStep] = useState<"request" | "verify">("request");
  const [otpCode, setOtpCode] = useState("");
  const [otpNotice, setOtpNotice] = useState<string | null>(null);
  const [devOtpHint, setDevOtpHint] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Google Modal state
  const [showGoogleModal, setShowGoogleModal] = useState(false);
  const [googleModalEmail, setGoogleModalEmail] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const googleBtnRef = useRef<HTMLDivElement>(null);

  // Countdown timer for OTP resend
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const interval = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [resendCooldown]);

  // Initialize Google Identity Services (GIS)
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.accounts?.id && googleBtnRef.current) {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: async (response: { credential?: string }) => {
            if (response.credential) {
              setGoogleBusy(true);
              setError(null);
              try {
                const res = await loginWithGoogle(response.credential);
                onAuthed(res.user);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Google sign-in failed.");
              } finally {
                setGoogleBusy(false);
              }
            }
          },
        });
        window.google.accounts.id.renderButton(googleBtnRef.current, {
          theme: "outline",
          size: "large",
          width: "340",
          text: "continue_with",
          shape: "pill",
        });
      }
    };
    document.body.appendChild(script);

    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, [onAuthed]);

  function switchMethod(next: AuthMethod) {
    setMethod(next);
    setError(null);
    setPassword("");
    setConfirm("");
    setOtpCode("");
    setOtpStep("request");
    setOtpNotice(null);
    setDevOtpHint(null);
  }

  // Handle Google Sign-In click
  async function handleGoogleClick() {
    if (busy || googleBusy) return;

    // If client ID is configured and GIS loaded, open Google prompt
    if (GOOGLE_CLIENT_ID && window.google?.accounts?.id) {
      window.google.accounts.id.prompt();
      return;
    }

    // Direct Google authentication flow
    const cleanEmail = email.trim().toLowerCase();
    if (cleanEmail && cleanEmail.includes("@")) {
      setGoogleBusy(true);
      setError(null);
      try {
        const res = await loginWithGoogle({ email: cleanEmail });
        onAuthed(res.user);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Google sign-in failed.");
      } finally {
        setGoogleBusy(false);
      }
      return;
    }

    // If no email entered in form yet, prompt for Google account email
    setGoogleModalEmail(email);
    setShowGoogleModal(true);
  }

  // Submit Google modal
  async function handleGoogleModalSubmit(e: FormEvent) {
    e.preventDefault();
    const cleanEmail = googleModalEmail.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      setError("Please enter a valid Google email address.");
      return;
    }

    setGoogleBusy(true);
    setError(null);
    try {
      const res = await loginWithGoogle({ email: cleanEmail });
      setShowGoogleModal(false);
      onAuthed(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed.");
    } finally {
      setGoogleBusy(false);
    }
  }

  // Handle OTP Send
  async function handleSendOtp(e?: FormEvent) {
    if (e) e.preventDefault();
    if (busy) return;
    setError(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      setError("Please enter a valid email address to receive your code.");
      return;
    }

    setBusy(true);
    try {
      const res = await sendOtp(cleanEmail);
      setOtpStep("verify");
      setOtpNotice(res.message);
      setResendCooldown(30);
      if (res.dev_otp) {
        setDevOtpHint(res.dev_otp);
        setOtpCode(res.dev_otp);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send verification code.");
    } finally {
      setBusy(false);
    }
  }

  // Handle OTP Verify
  async function handleVerifyOtp(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);

    const cleanEmail = email.trim().toLowerCase();
    const cleanOtp = otpCode.trim();
    if (!cleanOtp) {
      setError("Please enter the 6-digit verification code.");
      return;
    }

    setBusy(true);
    try {
      const res = await verifyOtp(cleanEmail, cleanOtp);
      onAuthed(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed. Check the code.");
    } finally {
      setBusy(false);
    }
  }

  // Handle Password Submit
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
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <div className="w-full max-w-sm animate-fade-in-up">
        {/* Header Branding */}
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/25">
            <svg
              className="h-7 w-7 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.8}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {method === "register"
              ? "Create your account"
              : method === "otp"
                ? "Sign in with Email Code"
                : "Welcome back"}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {method === "register"
              ? "Your documents stay private to your account."
              : method === "otp"
                ? "Passwordless sign-in with a 6-digit one-time code."
                : "Log in with your password to access your documents."}
          </p>
        </div>

        {/* Method Switcher Tabs */}
        <div className="mb-4 grid grid-cols-3 gap-1 rounded-xl bg-slate-200/80 p-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <button
            type="button"
            onClick={() => switchMethod("otp")}
            className={`rounded-lg py-1.5 transition-all ${
              method === "otp"
                ? "bg-white text-indigo-600 shadow-sm dark:bg-slate-700 dark:text-white"
                : "hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            Email Code
          </button>
          <button
            type="button"
            onClick={() => switchMethod("password")}
            className={`rounded-lg py-1.5 transition-all ${
              method === "password"
                ? "bg-white text-indigo-600 shadow-sm dark:bg-slate-700 dark:text-white"
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
                ? "bg-white text-indigo-600 shadow-sm dark:bg-slate-700 dark:text-white"
                : "hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            Register
          </button>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          {/* Google Sign-In Section */}
          <div className="mb-5 flex flex-col items-center">
            {GOOGLE_CLIENT_ID ? (
              <div ref={googleBtnRef} className="w-full flex justify-center" />
            ) : (
              <button
                type="button"
                onClick={handleGoogleClick}
                disabled={busy || googleBusy}
                className="flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition-all hover:bg-slate-50 hover:shadow dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700/80 disabled:opacity-60"
              >
                {googleBusy ? (
                  <Spinner className="h-5 w-5" />
                ) : (
                  <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                )}
                {googleBusy ? "Signing in with Google…" : "Continue with Google"}
              </button>
            )}

            <div className="relative my-4 flex w-full items-center justify-center">
              <div className="w-full border-t border-slate-200 dark:border-slate-700" />
              <span className="absolute bg-white px-3 text-xs text-slate-400 dark:bg-slate-900 dark:text-slate-500">
                or with email
              </span>
            </div>
          </div>

          {/* Form 1: OTP Login */}
          {method === "otp" && (
            <div>
              {otpStep === "request" ? (
                <form onSubmit={handleSendOtp} noValidate className="space-y-4">
                  <div>
                    <label
                      htmlFor="otp-email"
                      className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
                    >
                      Email address
                    </label>
                    <input
                      id="otp-email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      autoFocus
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={busy}
                      placeholder="you@example.com"
                      className={inputClass}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={busy || !email.trim()}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 text-sm font-medium text-white shadow-sm transition-all hover:shadow-md hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busy && <Spinner className="h-4 w-4" />}
                    {busy ? "Sending code…" : "Send verification code"}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleVerifyOtp} noValidate className="space-y-4">
                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                    <span>Code sent to: <strong className="text-slate-700 dark:text-slate-200">{email}</strong></span>
                    <button
                      type="button"
                      onClick={() => setOtpStep("request")}
                      className="text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      Change
                    </button>
                  </div>

                  <div>
                    <label
                      htmlFor="otp-code"
                      className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
                    >
                      6-Digit Verification Code
                    </label>
                    <input
                      id="otp-code"
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      autoFocus
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      disabled={busy}
                      placeholder="• • • • • •"
                      className={`${inputClass} text-center font-mono text-lg tracking-[0.35em]`}
                    />
                  </div>

                  {devOtpHint && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
                      <strong>Demo/Local Mode Code:</strong> <span className="font-mono font-bold tracking-wider">{devOtpHint}</span>
                      <p className="mt-0.5 text-[11px] opacity-80">(Configure SMTP_HOST in .env for real email delivery)</p>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={busy || otpCode.length < 6}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 text-sm font-medium text-white shadow-sm transition-all hover:shadow-md hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busy && <Spinner className="h-4 w-4" />}
                    {busy ? "Verifying…" : "Verify and sign in"}
                  </button>

                  <div className="flex justify-center text-xs text-slate-500 dark:text-slate-400">
                    {resendCooldown > 0 ? (
                      <span>Resend code in {resendCooldown}s</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleSendOtp()}
                        disabled={busy}
                        className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        Resend code
                      </button>
                    )}
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Form 2: Password Login or Register */}
          {method !== "otp" && (
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
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 text-sm font-medium text-white shadow-sm transition-all hover:shadow-md hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
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
          )}

          {/* Feedback alerts */}
          {error && (
            <div
              role="alert"
              className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300"
            >
              {error}
            </div>
          )}

          {otpNotice && !error && otpStep === "verify" && (
            <div className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
              {otpNotice}
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
                onClick={() => switchMethod("otp")}
                className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
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
                className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                Create an account
              </button>
            </>
          )}
        </p>
      </div>

      {/* Google Sign-In Prompt Modal */}
      {showGoogleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800">
                <svg className="h-5 w-5" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-slate-900 dark:text-slate-100">Sign in with Google</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Continue to DocQ&amp;A</p>
              </div>
            </div>

            <form onSubmit={handleGoogleModalSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Google account email
                </label>
                <input
                  type="email"
                  required
                  autoFocus
                  value={googleModalEmail}
                  onChange={(e) => setGoogleModalEmail(e.target.value)}
                  placeholder="you@gmail.com"
                  className={inputClass}
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowGoogleModal(false)}
                  className="flex-1 rounded-xl border border-slate-300 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={googleBusy || !googleModalEmail.trim()}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-2.5 text-xs font-medium text-white shadow hover:bg-indigo-700 disabled:opacity-60"
                >
                  {googleBusy && <Spinner className="h-3.5 w-3.5" />}
                  Continue
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

// Augment window object for Google GSI
declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: {
            client_id: string;
            callback: (res: { credential?: string }) => void;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              theme?: string;
              size?: string;
              width?: string;
              text?: string;
              shape?: string;
            },
          ) => void;
          prompt: () => void;
        };
      };
    };
  }
}
