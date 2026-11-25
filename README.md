# DocQ&A

An advanced Agentic Retrieval-Augmented Generation (RAG) platform powered by **LangGraph** StateGraph workflows and the **Model Context Protocol (MCP)**. Ask complex questions across knowledge bases with verified citations, live tool execution, and zero hallucinations.

**Live deployments**

| Surface | URL |
|---|---|
| Frontend (Vercel) | https://rag-app-three-tau.vercel.app/ |
| Backend API (Render) | https://rag-app-1-rqg6.onrender.com |
| API docs (Swagger UI) | https://rag-app-1-rqg6.onrender.com/docs |

> The backend runs on Render's free tier and may take ~30 seconds to wake from idle.

---

## Features

- **LangGraph Agentic StateGraph**: Orchestrates multi-step query contextualization, hybrid vector/lexical retrieval, document relevance grading, tool execution, and anti-hallucination reflection.
- **Model Context Protocol (MCP)**: Native in-process tool execution (math evaluation, real-time web fetching, workspace inspection, datetime) plus extensible external server support via `mcp_servers.json`.
- **Upload & Extraction**: Ingest PDF, plain text, or Markdown files (up to 20 MB per file) with PyMuPDF and fallback OCR (Tesseract / Gemini multimodal vision).
- **Multi-Turn Chat with Reasoning**: Real-time chain-of-thought thinking logs (`<thinking>`), suggested follow-up questions, and inline citations `[DocName.pdf]`.
- **Zero Hallucination Guard**: Mathematical cosine cutoff (0.78) with hybrid BM25 boost and self-correction verification loop.
- **Executive Summaries**: One-click structured AI briefings with critical highlights and strategic recommendations.
- **Modern Responsive UI**: Next.js 16 App Router, React 19, Tailwind CSS v4, KaTeX math typesetting, and dark mode.

---

## Agentic Architecture (LangGraph & MCP)

```
                       User Query
                           │
                           ▼
               [1. analyze_query]
              (Intent & Rewriting)
                    │             │
      (No docs/Greeting)   (Search Required)
                    │             │
                    ▼             ▼
       [conversational]     [2. retrieve]
        (Safe Greeting)   (Hybrid ChromaDB)
              │                   │
              │                   ▼
              │          [3. grade_and_route]
              │         (Relevance & Needs MCP?)
              │           │               │
              │      (Needs MCP)     (Docs Sufficient)
              │           │               │
              │           ▼               │
              │   [4. execute_mcp_tools]  │
              │     (Live Tools & Math)   │
              │           │               │
              │           └───────┬───────┘
              │                   │
              │                   ▼
              │         [5. generate_answer]
              │       (Deep Reasoning Protocol)
              │                   │
              │                   ▼
              │        [6. verify_grounding]
              │       (Anti-Hallucination Loop)
              │                   │
              └───────────────────┴──────────► [END]
```

---

## Tech Stack

| Layer | Technology | Role |
|---|---|---|
| Agent Orchestration | **LangGraph** (`langgraph`) | StateGraph cyclic workflow, node routing, self-correction |
| Tool Protocol | **Model Context Protocol** (`mcp`) | MCP client session, native tools & external tool server bridge |
| Backend API | FastAPI (Python 3.12+) | Async REST endpoints, MCP execution, request validation |
| Vector Store | ChromaDB | Persistent local HNSW vector database |
| Embeddings & Generation | Google Gemini (`gemini-embedding-2`, `gemini-3.8-flash`) | 768-dim embeddings and grounded reasoning generation |
| PDF Processing | PyMuPDF, pytesseract, Pillow | Native digital text parsing with OCR vision fallback |
| Frontend | Next.js 16 + React 19 + TypeScript | High-performance SPA with agent trace & MCP visualizer |
| Styling & Typography | Tailwind CSS v4 + KaTeX | Fast utility styling with LaTeX mathematical equations |

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
| `GENERATION_MODEL` | `gemini-3.8-flash` | |
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
| `GET` | `/health` | Health check; returns status, app name, and LangGraph/MCP flags |
| `GET` | `/graph/info` | Returns LangGraph architecture, node sequence, and feature list |
| `GET` | `/mcp/tools` | Discovers and lists all registered Model Context Protocol (MCP) tools |
| `POST` | `/mcp/execute` | Directly executes a specified MCP tool with JSON arguments |
| `GET` | `/documents` | List indexed documents with chunk counts |
| `POST` | `/upload` | Ingest a PDF, TXT, or Markdown file |
| `POST` | `/chat` | Executes LangGraph Adaptive RAG agentic workflow with cited answer |
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
