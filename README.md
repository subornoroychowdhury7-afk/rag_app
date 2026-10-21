# ⚡ DocQ&A — Enterprise RAG Platform

<div align="center">

**A production-grade document intelligence system. Upload any PDF, ask anything, get strictly grounded answers with verified citations.**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Vercel-black?style=for-the-badge&logo=vercel)](https://rag-app-blush.vercel.app)
[![Backend](https://img.shields.io/badge/API-Render-46E3B7?style=for-the-badge&logo=render&logoColor=white)](https://rag-app-1-rqg6.onrender.com/health)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Next.js](https://img.shields.io/badge/Next.js%2016-000000?style=for-the-badge&logo=next.js)](https://nextjs.org)
[![Gemini](https://img.shields.io/badge/Gemini%202.5-4285F4?style=for-the-badge&logo=google&logoColor=white)](https://ai.google.dev)
[![ChromaDB](https://img.shields.io/badge/ChromaDB-FF6B6B?style=for-the-badge)](https://www.trychroma.com)

</div>

---

## The Problem with Typical RAG Projects

Most open-source RAG demos you find online share the same fatal flaws:

- ❌ **Break on scanned PDFs** — naive text extraction fails on images and receipts  
- ❌ **Hallucinate freely** — blindly inject top-*K* chunks regardless of relevance  
- ❌ **Mix everyone's data** — one shared vector index for all users  
- ❌ **No real auth** — hardcoded secrets or no login at all  
- ❌ **Brittle deployment** — local-only indices that break in stateless cloud environments  

DocQ&A solves every one of these.

---

## What Makes This Different

| Problem | Standard RAG | DocQ&A |
|:---|:---|:---|
| **Scanned / image PDFs** | Crashes or returns blank | 3-tier ingestion: PyMuPDF → Tesseract OCR → Gemini Vision |
| **Hallucination** | Answers even when docs don't contain the answer | Cosine distance gate (`≤ 0.65`) — refuses to answer if no relevant chunk found |
| **Data privacy** | All users share one vector collection | Every chunk tagged with `user_id`; queries are strictly user-scoped |
| **Authentication** | None, or dummy accounts | Mandatory 6-digit Email OTP on all sign-in paths + scrypt password verification + 7-day JWTs |
| **Cloud deployment** | Breaks on stateless servers | Switches between local HNSW and Chroma Cloud automatically |
| **API failures** | Crashes on rate limits | Exponential backoff with 4 retries on every Gemini call |

---

## How It Works

```
Your PDF
   │
   ├─ 1. EXTRACT  ─ PyMuPDF (digital) → Tesseract OCR (scanned) → Gemini Vision (fallback)
   │
   ├─ 2. CHUNK    ─ Overlapping 1,800-char windows (10% overlap to preserve context)
   │
   ├─ 3. EMBED    ─ gemini-embedding-2 → 768-dim vectors, batched in parallel
   │
   └─ 4. STORE    ─ ChromaDB with user_id metadata for strict tenant isolation

Your Question
   │
   ├─ 1. EMBED    ─ Same model, retrieval_query task type
   │
   ├─ 2. SEARCH   ─ Cosine similarity against YOUR chunks only
   │
   ├─ 3. GATE     ─ Distance > 0.65? Stop. Return "I cannot answer." (no LLM call)
   │
   └─ 4. GENERATE ─ Gemini 2.5 Flash answers strictly from retrieved passages + citations
```

---

## Core Features

- **🔍 3-Tier Resilient OCR** — Handles digital PDFs, scanned documents, and image-heavy files without manual configuration
- **🛡️ Hallucination Gate** — Hard cutoff on cosine distance. The model never guesses when documents don't contain the answer
- **🔐 Multi-Tenant Isolation** — Each user's documents are isolated at the vector metadata level; no cross-user data leakage
- **✉️ Secure Email OTP Auth** — Mandatory 6-digit OTP verification across all login & registration paths (with 30s server-side cooldown, 5-attempt brute-force lockout, single-use expiry, and salted SHA-256 storage)
- **🔄 Hybrid Vector Backend** — Local ChromaDB for development, Chroma Cloud for stateless production — zero code change required
- **📑 Source Citations** — Every answer includes the exact passage it was derived from, expandable inline

---

## Tech Stack

```
Frontend        Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4
Backend         FastAPI · Uvicorn · PyMuPDF · Tesseract OCR · Pillow
AI & Vectors    Gemini 2.5 Flash · gemini-embedding-2 (768-dim) · ChromaDB
Auth & Storage  PyJWT (HS256) · scrypt · SQLite 3 (WAL mode)
Deployment      Vercel (frontend) · Render Docker (backend)
```

---

## Local Setup

```bash
# Backend
cd backend
python -m venv venv && venv\Scripts\activate    # Windows
pip install -r requirements.txt
cp .env.example .env                            # Add GEMINI_API_KEY
uvicorn main:app --reload

# Frontend
cd frontend
npm install
npm run dev                                     # http://localhost:3000
```

**Minimum required env vars:**
```
GEMINI_API_KEY=...        # Required for embeddings + generation
JWT_SECRET=...            # Any long random string

# Email Provider (At least one provider required for OTP delivery)
# Option A - Resend HTTPS (Recommended for Render, works over 443):
RESEND_API_KEY=re_...
RESEND_FROM=DocQ&A <notifications@yourverifieddomain.com>

# Option B - Standard SMTP (Gmail App Password, etc.):
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=587
# SMTP_USER=your_email@gmail.com
# SMTP_PASSWORD=your_16_character_app_password
# SMTP_FROM=your_email@gmail.com
```

---

## Deployment

| Service | Config |
|:---|:---|
| **Vercel** | Auto-deploys frontend on push to `main`. Set `NEXT_PUBLIC_API_URL` env var to your Render URL. |
| **Render** | Uses `render.yaml` + `backend/Dockerfile`. Set `GEMINI_API_KEY`, `JWT_SECRET`, and SMTP vars in Render dashboard. |

---

## License

MIT
