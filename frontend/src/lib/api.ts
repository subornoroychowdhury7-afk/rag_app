export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "https://rag-app-1-rqg6.onrender.com"
).replace(/\/+$/, "");

const DEFAULT_TIMEOUT_MS = 30_000;
const HEAVY_OPERATION_TIMEOUT_MS = 120_000;

/* ---------- Types ------------------------------------------------- */

export interface UploadResult {
  message: string;
  filename: string;
  chunks_processed: number;
}

export interface Citation {
  text: string;
  source: string;
  relevance: number;
  chunk_index?: number;
}

export interface ChatResult {
  answer: string;
  thinking?: string;
  sources: string[];
  source_files?: string[];
  citations?: Citation[];
  suggested_followups?: string[];
  model_used?: string;
}

export interface DocumentSummaryResult {
  filename: string;
  summary: string;
  total_chunks: number;
  truncated?: boolean;
}

export interface DeleteResult {
  message: string;
  filename: string;
  chunks_deleted: number;
}

export interface HealthResult {
  status: string;
  gemini_configured: boolean;
  vector_store_ready: boolean;
  generation_model: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/* ---------- Request helper ---------------------------------------- */

function errorDetail(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") {
      const lower = detail.toLowerCase();
      if (lower.includes("log in") || lower.includes("unauthorized") || lower.includes("not authenticated")) {
        return "The backend is updating or waking up. Please refresh the page and try again.";
      }
      return detail;
    }
    if (Array.isArray(detail)) {
      const msgs = detail
        .map((d) => (d && typeof d === "object" && "msg" in d ? String((d as { msg: unknown }).msg) : ""))
        .filter(Boolean);
      if (msgs.length) return msgs.join("; ");
    }
  }
  return fallback;
}

interface RequestOptions extends RequestInit {
  timeoutMs?: number;
}

async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: externalSignal, ...fetchInit } = init;
  const headers = new Headers(fetchInit.headers);

  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer);
      throw new DOMException("Request cancelled", "AbortError");
    }
    externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...fetchInit,
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    if (externalSignal?.aborted) {
      throw err instanceof Error ? err : new DOMException("Request cancelled", "AbortError");
    }
    if (timedOut) {
      throw new Error(
        `Request timed out after ${Math.round(timeoutMs / 1000)}s. If the Render backend is waking up, please retry in a moment.`
      );
    }
    throw new Error(
      `Can't reach the server at ${API_URL}. If it's hosted on Render it may be waking up - wait a moment and try again.`
    );
  } finally {
    clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
  }

  if (!res.ok) {
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

function jsonPost(body: unknown, signal?: AbortSignal): RequestOptions {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs: HEAVY_OPERATION_TIMEOUT_MS,
    signal,
  };
}

/* ---------- Documents, chat & health ------------------------------ */

export function getHealth(signal?: AbortSignal): Promise<HealthResult> {
  return request<HealthResult>("/health", { method: "GET", signal, timeoutMs: 15_000 });
}

export function uploadFile(file: File, signal?: AbortSignal): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  return request<UploadResult>("/upload", {
    method: "POST",
    body: form,
    timeoutMs: HEAVY_OPERATION_TIMEOUT_MS,
    signal,
  });
}

export function sendChat(
  query: string,
  history: ChatMessage[] = [],
  docFilter?: string | null,
  mode: "detailed" | "concise" | "academic" | "step_by_step" = "detailed",
  signal?: AbortSignal
): Promise<ChatResult> {
  const payload: { query: string; history: ChatMessage[]; doc_filter?: string; mode?: string } = {
    query,
    history,
    mode,
  };
  if (docFilter && docFilter.trim()) {
    payload.doc_filter = docFilter.trim();
  }
  return request<ChatResult>("/chat", jsonPost(payload, signal));
}

export function summarizeDocument(
  filename: string,
  signal?: AbortSignal
): Promise<DocumentSummaryResult> {
  return request<DocumentSummaryResult>(
    `/documents/${encodeURIComponent(filename)}/summarize`,
    {
      method: "POST",
      timeoutMs: HEAVY_OPERATION_TIMEOUT_MS,
      signal,
    }
  );
}

export function deleteDocument(filename: string): Promise<DeleteResult> {
  return request<DeleteResult>(`/documents/${encodeURIComponent(filename)}`, {
    method: "DELETE",
  });
}

export function getDocuments(signal?: AbortSignal): Promise<{ name: string; chunks: number }[]> {
  return request<{ name: string; chunks: number }[]>("/documents", {
    method: "GET",
    signal,
  });
}
