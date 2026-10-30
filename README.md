# DocQ&A

A Retrieval-Augmented Generation (RAG) application that lets you ask natural-language questions against uploaded documents and receive cited, grounded answers. There is no login or account required.

**Live deployments**

| Surface | URL |
|---|---|
| Frontend (Vercel) | https://rag-app-blush.vercel.app |
| Backend API (Render) | https://rag-app-1-rqg6.onrender.com |
| API docs (Swagger UI) | https://rag-app-1-rqg6.onrender.com/docs |

> The backend runs on Render's free tier and may take ~30 seconds to wake from idle.

---

## Features

- Upload PDF, plain text, or Markdown files (up to 20 MB per file)
- PDF text extraction via PyMuPDF; scanned pages OCR'd with Tesseract or, when Tesseract is unavailable, with Gemini's native PDF transcription
- Multi-turn conversational Q&A with chat history
- Every answer includes source citations with chunk text and a cosine-similarity relevance score
- Optional document filter to scope a conversation to a single file
- One-click AI executive summary for any indexed document
- Document management: list, inspect chunk counts, delete
- Light and dark theme

---

## RAG Pipeline

```
Upload → extract text → chunk with overlap → embed (Gemini) → ChromaDB

Query  → embed query → cosine similarity search → distance filter → Gemini generation → cited answer
```

**Defaults (configurable via environment variables):**

- Chunk size: **1,800 characters**
- Chunk overlap: **300 characters**
- Embedding model: `models/gemini-embedding-2` (768 dimensions)
- Generation model: `gemini-3.5-flash`
- Cosine distance cutoff: **0.75** (chunks with distance > 0.75 are discarded; lower distance = higher similarity)
- Top-K retrieval: 10 chunks per query

If no chunk passes the distance cutoff, the API returns a fixed fallback message rather than generating an unsupported answer.

---

## Tech Stack

| Layer | Technology | Role |
|---|---|---|
| Backend API | FastAPI (Python 3.12) | REST endpoints, request validation, CORS |
| Vector store | ChromaDB | Persistent local store (HNSW/cosine) or Chroma Cloud |
| Embeddings & generation | Google Gemini (`google-generativeai`) | `gemini-embedding-2` for vectors, `gemini-3.5-flash` for answers and summaries |
| PDF processing | PyMuPDF, pytesseract, Pillow | Text extraction and per-page OCR |
| Frontend | Next.js 16 + React 19 + TypeScript | App Router SPA |
| Styling | Tailwind CSS v4 | Utility-first styling |
| Math rendering | remark-math + rehype-katex | LaTeX in answers |
| Container | Docker (`python:3.12-slim` + Tesseract) | Production image published to GHCR |
| Backend hosting | Render (free tier, Docker runtime) | Defined in `render.yaml` |
| Frontend hosting | Vercel and GitHub Pages | Static export for Pages, full SSR on Vercel |
| CI/CD | GitHub Actions (`deploy.yml`) | Deploy on push to `main` |

---

## Local Setup

**Prerequisites:** Python 3.12, Node.js >= 20, a [Google Gemini API key](https://ai.google.dev/gemini-api/docs/api-key).
Tesseract OCR is optional — the backend falls back to Gemini-based PDF transcription when Tesseract is not installed.

### Backend

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env    # edit .env and set GEMINI_API_KEY
uvicorn main:app --reload
```

API available at `http://localhost:8000`. Swagger UI at `http://localhost:8000/docs`.

### Frontend

```powershell
cd frontend
npm install
```

Create `frontend/.env.local`:

```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

```powershell
npm run dev
```

Open `http://localhost:3000`.

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Default | Notes |
|---|---|---|
| `GEMINI_API_KEY` | — | **Required.** Embeddings, generation, and OCR fallback |
| `EMBEDDING_MODEL` | `models/gemini-embedding-2` | |
| `EMBEDDING_DIM` | `768` | |
| `GENERATION_MODEL` | `gemini-3.5-flash` | |
| `CHUNK_SIZE` | `1800` | Characters per chunk |
| `CHUNK_OVERLAP` | `300` | Overlap between adjacent chunks |
| `MAX_DISTANCE` | `0.75` | Cosine distance cutoff (0 = identical) |
| `MAX_UPLOAD_MB` | `20` | |
| `CHROMA_PATH` | `./chroma_db` | Local vector store path |
| `CHROMA_API_KEY` | — | Set to enable Chroma Cloud mode |
| `CHROMA_TENANT` | — | Chroma Cloud only |
| `CHROMA_DATABASE` | — | Chroma Cloud only |
| `ALLOWED_ORIGINS` | `*` | CORS allowed origins |

### Frontend (`frontend/.env.local`)

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_API_URL` | Backend base URL |
| `NEXT_PUBLIC_BASE_PATH` | Set automatically by `deploy.yml` for GitHub Pages |

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check; returns `gemini_configured` flag |
| `GET` | `/documents` | List indexed documents with chunk counts |
| `POST` | `/upload` | Ingest a PDF, TXT, or Markdown file |
| `POST` | `/chat` | Embed query, retrieve chunks, generate cited answer |
| `POST` | `/documents/{filename}/summarize` | Generate an executive AI briefing |
| `DELETE` | `/documents/{filename}` | Remove a document and all its chunks |

Full interactive schema: https://rag-app-1-rqg6.onrender.com/docs

---

## Deployment

### GitHub Actions (`deploy.yml`)

Triggered on push to `main` and supports `workflow_dispatch`. Contains four parallel jobs:

1. **Deploy to GitHub Pages** — builds a Next.js static export (`OUTPUT_EXPORT=true`) and deploys to GitHub Pages using the official `actions/deploy-pages` action. `NEXT_PUBLIC_BASE_PATH` is set automatically from the repository name.
2. **Publish to GHCR** — builds the backend Docker image and pushes `backend:latest` and `backend:<sha>` to `ghcr.io`.
3. **Trigger Render redeploy** — calls `RENDER_DEPLOY_HOOK_URL` if the secret is set; otherwise relies on Render's native Git integration.
4. **Deploy to Vercel** — runs `vercel deploy --prod` if `VERCEL_TOKEN` is set; otherwise relies on Vercel's native Git integration.

### Render

Connect the repository on [Render](https://render.com) using the **Blueprint** option (`render.yaml`) or point a Web Service at `backend/Dockerfile`. Add `GEMINI_API_KEY` as an environment secret in the Render dashboard. The `render.yaml` sets `CHROMA_PATH` and `ALLOWED_ORIGINS` automatically.

### Vercel

Import the repository on [Vercel](https://vercel.com), set the root directory to `frontend`, and add `NEXT_PUBLIC_API_URL` pointing to your Render backend URL.

---

## Tests

Backend tests use `unittest` and FastAPI's `TestClient` and are located in `backend/test_api.py`. They cover endpoint contracts (health check, document listing, upload validation, chat validation, delete, summarize) and filename sanitization.

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
pytest                          # uses pytest.ini configuration
# or
python -m unittest test_api
```

Frontend linting:

```powershell
cd frontend
npm run lint
```

---

## Project Structure

```
rag-app/
├── backend/
│   ├── main.py              # FastAPI app: ingestion, retrieval, generation
│   ├── test_api.py          # unittest + FastAPI TestClient tests
│   ├── Dockerfile           # python:3.12-slim + Tesseract OCR
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── app/             # Next.js App Router (layout, page)
│   │   ├── components/      # Chat, Sidebar, Header, SummaryModal, MarkdownRenderer
│   │   └── lib/             # API client and TypeScript types
│   ├── next.config.ts       # Static export support
│   └── package.json
├── .github/
│   └── workflows/
│       └── deploy.yml       # Pages + GHCR + Render + Vercel deployment
├── render.yaml              # Render service definition
└── README.md
```

---

> Never commit `GEMINI_API_KEY`, `.env` files, or the local `chroma_db/` directory.
