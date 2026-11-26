# DocQ&A — Production Software Engineering Roadmap

This roadmap documents how core software engineering principles (Clean Architecture, SOLID, Security-by-Design, Observability, Resilience, Automated Testing, and CI/CD Quality Gates) apply to **DocQ&A** and tracks each implementation phase.

---

## 1. Architectural Baseline & Gaps Identified

| Dimension | Initial State | Production Target |
|---|---|---|
| **Backend Structure** | 899-line single-file monolith (`backend/main.py`) | Layered modular package (`backend/app/config.py`, `schemas.py`, `middleware.py`, `services/*`) |
| **Security & Input Validation** | Extension-only upload check, `*` CORS with `allow_credentials=True`, root Docker container, no rate limiting | Magic-byte / UTF-8 file verification, spec-compliant CORS, security headers, sliding-window rate limiter, non-root Docker user |
| **Observability & Health** | Plain logs without correlation IDs; static `/health` | `X-Request-ID` & `X-Process-Time-Ms` middleware, structured contextual logs, ChromaDB readiness probe |
| **Frontend Resilience** | Volatile in-memory chat, `alert()` dialogs, infinite fetch waits, no Error Boundary | `localStorage` chat persistence, `AbortController` timeouts + Stop button, inline errors, Next.js `error.tsx` |
| **CI/CD & Testing** | 12 tests; `deploy.yml` deployed directly without running tests or builds | `backend-ci` + `frontend-ci` gates blocking deployments; PR CI workflow; full mocked E2E + unit tests |

---

## 2. Implementation Phases

### Phase 1 — Clean Architecture & SOLID Modularity (Implemented)
- Extract immutable typed settings into `backend/app/config.py`.
- Define strict Pydantic request/response contracts in `backend/app/schemas.py`.
- Isolate PDF/text ingestion, magic-byte validation, filename sanitization, and semantic recursive chunking in `backend/app/services/document_processor.py`.
- Wrap ChromaDB (local & Cloud) behind a clean repository/adapter interface in `backend/app/services/vector_store.py`.
- Isolate Gemini SDK calls, exponential backoff retries, model fallback, and concurrency batching in `backend/app/services/llm_client.py`.
- Encapsulate hybrid retrieval, query contextualization, citation scoring, and executive summarization in `backend/app/services/rag_service.py`.
- Keep `backend/main.py` as a clean FastAPI composition root while preserving compatibility exports.

### Phase 2 — Security & Hardening (Implemented)
- **File Content Validation**: Verify `%PDF-` magic header on PDF uploads and reject NUL-byte binary payloads masquerading as `.txt`/`.md`.
- **Spec-Compliant CORS**: Disable `allow_credentials` automatically when `ALLOWED_ORIGINS` is wildcard `*`; enable only for explicit origin allowlists.
- **HTTP Security Headers Middleware**: Inject `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Permissions-Policy`.
- **Rate Limiting**: Thread-safe per-client sliding-window rate limiter protecting compute/cost-heavy endpoints (`/upload`, `/chat`, `/summarize`) with `429 Too Many Requests` + `Retry-After`.
- **Container Hardening**: Non-root `appuser` and Docker `HEALTHCHECK` in `backend/Dockerfile`.

### Phase 3 — Observability & Reliability (Implemented)
- **Request Tracing Middleware**: Attach/propagate `X-Request-ID` and `X-Process-Time-Ms` headers on every response and emit structured request completion logs.
- **Deep Health Check (`GET /health`)**: Verify vector store connectivity (`ping()`) alongside API key status (`status: "ok" | "degraded"`).
- **Frontend Resilience**:
  - `AbortController` request timeouts + user-triggered **Stop generating** cancellation in `Chat.tsx` and request cancellation on modal close/unmount in `SummaryModal.tsx`.
  - Non-blocking inline error notifications replacing `window.alert`.
  - Versioned `localStorage` conversation persistence in `Chat.tsx` + React Error Boundary (`frontend/src/app/error.tsx`).
  - Clean out dead `pageFileInputRef` in `page.tsx` and align code proofs in `LandingView.tsx` with actual source paths.

### Phase 4 — Automated Testing Pyramid (Implemented)
- **Unit Tests (`backend/test_services.py`)**: Document magic-byte validation, chunking invariants, keyword scoring, CORS origin resolution, rate limiter windowing, and prompt/response parsing.
- **Integration & Contract Tests (`backend/test_api.py`)**: Full mocked end-to-end `/upload` -> `/documents` -> `/chat` (citations + refusal + greeting) -> `/documents/{name}/summarize` -> `/documents/{name}` DELETE, `X-Request-ID`, security headers, and `429` rate limit enforcement.

### Phase 5 — CI/CD Quality Gates (Implemented)
- Dedicated `.github/workflows/ci.yml` for pull requests and pushes.
- Gate `.github/workflows/deploy.yml` deployment jobs (`deploy-github-pages`, `publish-ghcr`, `trigger-render-deploy`, `deploy-vercel`) behind passing `backend-ci` (`pytest`) and `frontend-ci` (`tsc --noEmit`, `eslint`, `next build`, and static export check).

---

## 3. Future Enterprise Scale Roadmap (Next Iterations)

1. **Streaming Generation (SSE / WebSockets)**: Stream tokens incrementally from `/chat/stream` with live `<thinking>` vs answer separation to cut perceived Time-To-First-Token (TTFT).
2. **Async Task Queue for Heavy Ingestion**: Offload large OCR PDF jobs to Redis + ARQ/Celery workers with `202 Accepted` status polling so API workers never block on multi-page Tesseract OCR.
3. **Hybrid Retrieval + Cross-Encoder Reranking + Golden Eval Suite**: Combine Chroma dense vectors with BM25/FTS5 + Reciprocal Rank Fusion (RRF), plus an automated RAGAS / golden-QA faithfulness regression gate in CI.
4. **OpenTelemetry & Metrics**: Export OTel spans and Prometheus counters (token spend, retrieval latency P95, refusal rate, OCR fallback rate).
5. **Multi-Tenancy & Auth**: Add workspace/user namespaces in Chroma metadata + JWT/OAuth tenant isolation and encrypted object storage for original files.
