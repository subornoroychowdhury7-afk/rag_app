import { clearAuthSession, getAuthToken } from "./auth";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "https://rag-app-1-rqg6.onrender.com";

export interface AuthResult {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
  user: { email: string };
}

export interface UploadResult {
  message: string;
  filename: string;
  chunks_processed: number;
}

export interface ChatResult {
  answer: string;
  sources: string[];
}

export interface DeleteResult {
  message: string;
  filename: string;
  chunks_deleted: number;
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  const headers = new Headers(init.headers);
  const token = getAuthToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw new Error(`Can't reach the backend at ${API_URL}. Is uvicorn running?`);
  }
  if (!res.ok) {
    if (res.status === 401 && token && !path.startsWith("/auth/")) {
      clearAuthSession();
      window.dispatchEvent(new Event("auth:unauthorized"));
    }
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      /* non-JSON error body - keep the generic message */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export function register(email: string, password: string) {
  return request<AuthResult>("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

export function login(email: string, password: string) {
  return request<AuthResult>("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

export function uploadPdf(file: File) {
  const form = new FormData();
  form.append("file", file);
  return request<UploadResult>("/upload", { method: "POST", body: form });
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export function sendChat(query: string, history: ChatMessage[] = []) {
  return request<ChatResult>("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, history }),
  });
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
