export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "https://rag-app-1-rqg6.onrender.com";

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
  id: number;
  email: string;
}

export interface AuthResult {
  token: string;
  user: AuthUser;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/* ---------- Session token ----------------------------------------- */

const TOKEN_KEY = "docqa_token";

/** Fired when the server says our session is no longer valid (expired/invalid token). */
export const AUTH_EXPIRED_EVENT = "docqa:auth-expired";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable (private mode etc.) - the session just won't persist */
  }
}

/* ---------- Request helper ---------------------------------------- */

function errorDetail(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    // FastAPI validation errors arrive as a list of {msg: ...}
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
    if (res.status === 401 && authed) {
      // Session expired or token invalid: drop it and let the app show the login screen.
      setToken(null);
      if (typeof window !== "undefined") window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON error body - keep the generic message */
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
  const res = await request<AuthResult>("/auth/login", jsonPost({ email, password }), false);
  setToken(res.token);
  return res;
}

export async function register(email: string, password: string): Promise<AuthResult> {
  const res = await request<AuthResult>("/auth/register", jsonPost({ email, password }), false);
  setToken(res.token);
  return res;
}

export function getMe() {
  return request<{ user: AuthUser }>("/auth/me", { method: "GET" });
}

export function logout(): void {
  setToken(null);
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
