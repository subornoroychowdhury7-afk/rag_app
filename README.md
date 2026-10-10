# ⚡ Enterprise RAG Platform

> **A production-grade Retrieval-Augmented Generation (RAG) platform with hybrid OCR ingestion, strict cosine distance gating, multi-tenant data isolation, and multi-method authentication.**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Vercel-black?style=for-the-badge&logo=vercel)](https://rag-app-blush.vercel.app)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Next.js](https://img.shields.io/badge/Frontend-Next.js%2016-000000?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org)
[![React](https://img.shields.io/badge/UI-React%2019-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![Google Gemini](https://img.shields.io/badge/AI-Gemini%202.5%20%2F%20Embedding--2-4285F4?style=for-the-badge&logo=google&logoColor=white)](https://ai.google.dev)
[![ChromaDB](https://img.shields.io/badge/Vector%20DB-ChromaDB-FF6B6B?style=for-the-badge)](https://www.trychroma.com)

---

## 📌 Introduction

Most open-source RAG implementations are brittle prototypes: they fail on scanned PDFs, mix all user data into a shared vector index, hallucinate answers when documents lack context, and lack real authentication.

This platform solves those core failure modes. It is a full-stack, end-to-end document intelligence system that enables users to securely upload PDFs and query them in natural language, delivering **strictly grounded answers with verified passage citations** powered by Google Gemini and ChromaDB.

---

## ⚡ Why & How It’s Different

| Feature | Standard RAG Projects on GitHub | This Platform |
| :--- | :--- | :--- |
| **PDF Extraction** | Naive digital-only parsers (`pypdf`); crashes on scanned docs and image pages. | **3-Tier Resilient Ingestion:** Digital extraction with **PyMuPDF**, automatic page fallback to **Tesseract OCR (200 DPI)**, and cloud fallback to **Gemini Multimodal Vision**. |
| **Hallucination Control** | Blindly injects top-$K$ vectors into LLM context, prompting hallucinations for missing data. | **Cosine Distance Gating:** Evaluates distance against cutoff (`MAX_DISTANCE = 0.65`). Halts immediately if irrelevant, avoiding hallucinations and saving LLM tokens. |
| **Data Privacy** | Single shared collection where all users' data is mixed together. | **Strict Tenant Isolation:** Every document chunk is tagged with `user_id`. Queries, listings, and deletions are strictly scoped to the authenticated user. |
| **Authentication** | None, hardcoded secrets, or dummy accounts. | **Complete Auth Suite:** Password authentication with `scrypt` hashing, **Google OAuth SSO**, and passwordless **6-digit Email OTP** (SMTP) with 7-day JWTs. |
| **Vector Topology** | Hardcoded local disk indices that break stateless server deployments. | **Hybrid Architecture:** Seamlessly toggles between local disk storage (`HNSW`) and cloud-native **Chroma Cloud** (`Spann`). |
| **API Resilience** | Fails on Gemini quota spikes or transient 429/503 errors. | **Exponential Backoff:** Built-in auto-retry wrapper handling transient rate limits and network drops. |

---

## 🚀 Core Features

- **Hybrid Document Ingestion & OCR:** Extracts text from both digital and scanned PDFs with automatic image OCR fallback.
- **Strictly Grounded Chat & Citations:** Answers are derived strictly from retrieved passages, complete with expandable source citations and one-click copy.
- **Document Lifecycle Management:** Real-time document inventory with live chunk counts, atomic deletion, and overwrite deduplication.
- **Multi-Method Authentication:** Supports Email/Password, Google OAuth One-Tap SSO, and Email OTP login options.
- **Modern Responsive Interface:** Clean Next.js 16 SPA featuring instant session restoration, dark/light theme toggle, and Markdown rendering.

---

## 🛠️ Tech Stack

- **Frontend:** [Next.js 16](https://nextjs.org) (App Router), [React 19](https://react.dev), [TypeScript](https://www.typescriptlang.org), [Tailwind CSS v4](https://tailwindcss.com), `react-markdown`
- **Backend:** [FastAPI](https://fastapi.tiangolo.com), [Uvicorn](https://www.uvicorn.org), [PyMuPDF (Fitz)](https://pymupdf.readthedocs.io), [pytesseract](https://pypi.org/project/pytesseract/), [Pillow](https://python-pillow.org), `pyjwt`, `google-auth`
- **AI & Vector DB:** [Google Gemini 2.5 Flash](https://ai.google.dev), `gemini-embedding-2` (768-dim), [ChromaDB](https://www.trychroma.com) (Local HNSW & Cloud Spann)
- **Database & Storage:** SQLite3 (WAL mode) for user accounts and OTP sessions
- **Deployment:** [Vercel](https://vercel.com) (Frontend), [Render](https://render.com) Docker Container (Backend)

---

## 📄 License

Distributed under the **MIT License**.
