# 🤖 RAG Application

A full-stack Retrieval-Augmented Generation (RAG) platform built with Python and TypeScript. Query custom documents with grounded context using modern LLM pipelines.

🚀 **Live Demo:** [https://rag-app-blush.vercel.app](https://rag-app-blush.vercel.app)

---

## ✨ Features

- **Document Ingestion:** Support for PDF files only.
- **Contextual Search:** Vector similarity search using semantic embeddings.
- **Grounded Responses:** AI responses powered by LLM orchestration with context citations.
- **Modern UI:** Clean, responsive chat interface built with Next.js/TypeScript.

---

## 🛠️ Tech Stack

- **Frontend:** Next.js / React, TypeScript, Tailwind CSS
- **Backend:** Python (FastAPI / Flask / LangChain / LlamaIndex)
- **Vector Database:**  ChromaDB / Pinecone / Qdrant
- **LLM / Embeddings:** OpenAI GPT-4 / HuggingFace / Cohere
- **Deployment:** Vercel (Frontend), Render (Backend)

---

## 🔐 Accounts and privacy

The backend provides email/password registration and login. Passwords are stored as salted PBKDF2-SHA256 hashes, and the frontend keeps a 12-hour bearer token in the current browser tab's session storage. Set a random `AUTH_SECRET` of at least 32 characters; the Render blueprint generates one. For local development, set it in `backend/.env` and use `AUTH_DB_PATH=./auth.sqlite3`.

Authenticated users can only list, search, replace, or delete their own documents. Existing Chroma records without an `owner_id` are intentionally inaccessible through the API and need to be re-uploaded after accounts are enabled. Default abuse limits are 30 chat requests per user per hour, 10 uploads per user per day, 100 login or registration attempts per client IP per 15 minutes, and 10 login attempts per email per 15 minutes. Override these with `CHAT_LIMIT_PER_HOUR`, `UPLOAD_LIMIT_PER_DAY`, `AUTH_LIMIT_PER_15_MINUTES`, and `LOGIN_EMAIL_LIMIT_PER_15_MINUTES`. Rate-limit events and account activity are recorded in backend logs without logging passwords or chat content.

The free Render blueprint has no persistent disk: the SQLite account/rate-limit database and local Chroma index can be erased whenever the service restarts, redeploys, or spins down. This configuration is suitable only for a disposable demo; use persistent storage before relying on accounts or uploaded documents.

---

## 📁 Repository Structure

```text
rag_app/
├── backend/          # Python API, Vector DB connections, LLM logic
├── frontend/         # Next.js UI & client state management
└── .gitignore        # Ignored files and environment variables
