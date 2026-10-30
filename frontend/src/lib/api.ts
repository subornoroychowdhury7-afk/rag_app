export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "https://rag-app-1-rqg6.onrender.com"
).replace(/\/+$/, "");

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
  sources: string[];
  source_files?: string[];
  citations?: Citation[];
  suggested_followups?: string[];
}

export interface DocumentSummaryResult {
  filename: string;
  summary: string;
  total_chunks: number;
}

export interface DeleteResult {
  message: string;
  filename: string;
  chunks_deleted: number;
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw new Error(
      `Can't reach the server at ${API_URL}. If it's hosted on Render it may be waking up - wait a moment and try again.`,
    );
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

function jsonPost(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/* ---------- Documents & chat -------------------------------------- */

export function uploadFile(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  return request<UploadResult>("/upload", { method: "POST", body: form });
}

export const uploadPdf = uploadFile;

export function sendChat(
  query: string,
  history: ChatMessage[] = [],
  docFilter?: string | null,
  mode: "detailed" | "concise" | "academic" | "step_by_step" = "detailed"
): Promise<ChatResult> {
  const payload: { query: string; history: ChatMessage[]; doc_filter?: string; mode?: string } = {
    query,
    history,
    mode,
  };
  if (docFilter && docFilter.trim()) {
    payload.doc_filter = docFilter.trim();
  }
  return request<ChatResult>("/chat", jsonPost(payload));
}

export function summarizeDocument(filename: string): Promise<DocumentSummaryResult> {
  return request<DocumentSummaryResult>(
    `/documents/${encodeURIComponent(filename)}/summarize`,
    {
      method: "POST",
    }
  );
}

export function deleteDocument(filename: string): Promise<DeleteResult> {
  return request<DeleteResult>(`/documents/${encodeURIComponent(filename)}`, {
    method: "DELETE",
  });
}

export function getDocuments(): Promise<{ name: string; chunks: number }[]> {
  return request<{ name: string; chunks: number }[]>("/documents", {
    method: "GET",
  });
}
