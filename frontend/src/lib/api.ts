import { clearAuthSession, getAuthEmail, getAuthToken, setAuthSession } from "./auth";

export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "https://rag-app-1-rqg6.onrender.com"
).replace(/\/+$/, "");

/* ---------- Types ------------------------------------------------- */

export interface UploadResult {
  message: string;
  filename: string;
  chunks_processed: number;
}

export interface ChatResult {
  answer: string;
  sources: string[];
  source_files?: string[];
}

export interface DeleteResult {
  message: string;
  filename: string;
  chunks_deleted: number;
}

export interface AuthUser {
  id?: number | string;
  email: string;
}

export interface AuthResult {
  token: string;
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  user: AuthUser;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/* ---------- Session token ----------------------------------------- */

export const AUTH_EXPIRED_EVENT = "docqa:auth-expired";

export function getToken(): string | null {
  return getAuthToken();
}

export function setToken(token: string | null, email?: string): void {
  if (token) {
    setAuthSession(token, email || getAuthEmail() || "");
  } else {
    clearAuthSession();
  }
}

export function getUserFromToken(token: string): AuthUser | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const jsonStr = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(jsonStr);
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return {
      id: payload.sub,
      email: payload.email || getAuthEmail() || "",
    };
  } catch {
    return null;
  }
}

/* ---------- Request helper ---------------------------------------- */

function errorDetail(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      const msgs = detail
        .map((d) => (d && typeof d === "object" && "msg" in d ? String((d as { msg: unknown }).msg) : ""))
        .filter(Boolean);
      if (msgs.length) return msgs.join("; ");
    }
  }
  return fallback;
}

async function request<T>(path: string, init: RequestInit = {}, authed = true): Promise<T> {
  const headers = new Headers(init.headers);
  const token = authed ? getToken() : null;
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw new Error(
      `Can't reach the server at ${API_URL}. If it's hosted on Render it may be waking up - wait a moment and try again.`,
    );
  }

  if (!res.ok) {
    if (res.status === 401 && authed && !path.startsWith("/auth/")) {
      clearAuthSession();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
        window.dispatchEvent(new Event("auth:unauthorized"));
      }
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON error body */
    }
    throw new Error(errorDetail(body, `Request failed (${res.status})`));
  }
  return res.json() as Promise<T>;
}

/* ---------- Auth -------------------------------------------------- */

function jsonPost(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export async function login(email: string, password: string): Promise<AuthResult> {
  const cleanEmail = email.trim().toLowerCase();
  const res = await request<any>("/auth/login", jsonPost({ email: cleanEmail, password }), false);
  const token = res.token || res.access_token;
  if (!token) throw new Error("Login failed: No authentication token received.");
  const user: AuthUser = res.user?.email
    ? { id: res.user.id, email: res.user.email }
    : { email: cleanEmail };
  setAuthSession(token, user.email);
  return { token, user, access_token: token };
}

export async function register(email: string, password: string): Promise<AuthResult> {
  const cleanEmail = email.trim().toLowerCase();
  const res = await request<any>("/auth/register", jsonPost({ email: cleanEmail, password }), false);
  const token = res.token || res.access_token;
  if (!token) throw new Error("Registration failed: No authentication token received.");
  const user: AuthUser = res.user?.email
    ? { id: res.user.id, email: res.user.email }
    : { email: cleanEmail };
  setAuthSession(token, user.email);
  return { token, user, access_token: token };
}

export async function sendOtp(email: string): Promise<{ message: string; dev_otp?: string; expires_in: number }> {
  const cleanEmail = email.trim().toLowerCase();
  return request<{ message: string; dev_otp?: string; expires_in: number }>(
    "/auth/otp/send",
    jsonPost({ email: cleanEmail }),
    false,
  );
}

export async function verifyOtp(email: string, otp: string): Promise<AuthResult> {
  const cleanEmail = email.trim().toLowerCase();
  const res = await request<any>(
    "/auth/otp/verify",
    jsonPost({ email: cleanEmail, otp: otp.trim() }),
    false,
  );
  const token = res.token || res.access_token;
  if (!token) throw new Error("OTP verification failed: No authentication token received.");
  const user: AuthUser = res.user?.email
    ? { id: res.user.id, email: res.user.email }
    : { email: cleanEmail };
  setAuthSession(token, user.email);
  return { token, user, access_token: token };
}

export async function loginWithGoogle(credential: string): Promise<AuthResult> {
  const res = await request<any>(
    "/auth/google",
    jsonPost({ credential: credential.trim() }),
    false,
  );
  const token = res.token || res.access_token;
  if (!token) throw new Error("Google sign-in failed: No authentication token received.");
  const user: AuthUser = res.user || { email: "Google User" };
  setAuthSession(token, user.email);
  return { token, user, access_token: token };
}

export async function getMe(): Promise<{ user: AuthUser }> {
  try {
    const res = await request<any>("/auth/me", { method: "GET" });
    if (res && res.user && res.user.email) {
      return { user: res.user };
    }
    if (res && res.email) {
      return { user: { id: res.id, email: res.email } };
    }
  } catch (err) {
    const token = getToken();
    if (token) {
      const decoded = getUserFromToken(token);
      if (decoded && decoded.email) {
        return { user: decoded };
      }
    }
    throw err;
  }
  const token = getToken();
  if (token) {
    const decoded = getUserFromToken(token);
    if (decoded && decoded.email) return { user: decoded };
  }
  throw new Error("Unable to retrieve user session");
}

export function logout(): void {
  clearAuthSession();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    window.dispatchEvent(new Event("auth:unauthorized"));
  }
}

/* ---------- Documents & chat -------------------------------------- */

export function uploadPdf(file: File) {
  const form = new FormData();
  form.append("file", file);
  return request<UploadResult>("/upload", { method: "POST", body: form });
}

export function sendChat(query: string, history: ChatMessage[] = []) {
  return request<ChatResult>("/chat", jsonPost({ query, history }));
}

export function deleteDocument(filename: string) {
  return request<DeleteResult>(`/documents/${encodeURIComponent(filename)}`, {
    method: "DELETE",
  });
}

export function getDocuments() {
  return request<{ name: string; chunks: number }[]>("/documents", {
    method: "GET",
  });
}
