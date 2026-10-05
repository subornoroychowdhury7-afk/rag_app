# 🤖 RAG Application

A full-stack Retrieval-Augmented Generation (RAG) platform built with Python and TypeScript. Query custom documents with grounded context using modern LLM pipelines.

🚀 **Live Demo:** [https://rag-app-blush.vercel.app](https://rag-app-blush.vercel.app)

---

## ✨ Features

- **Document Ingestion:** Support for PDF, TXT, and Markdown indexing.
- **Contextual Search:** Vector similarity search using semantic embeddings.
- **Grounded Responses:** AI responses powered by LLM orchestration with context citations.
- **Modern UI:** Clean, responsive chat interface built with Next.js/TypeScript.

---

## 🛠️ Tech Stack

- **Frontend:** Next.js / React, TypeScript, Tailwind CSS
- **Backend:** Python (FastAPI / Flask / LangChain / LlamaIndex)
- **Vector Database:** [e.g., ChromaDB / Pinecone / Qdrant]
- **LLM / Embeddings:** [e.g., OpenAI GPT-4 / HuggingFace / Cohere]
- **Deployment:** Vercel (Frontend), [e.g., Render / Fly.io] (Backend)

---

## 📁 Repository Structure

```text
rag_app/
├── backend/          # Python API, Vector DB connections, LLM logic
├── frontend/         # Next.js UI & client state management
└── .gitignore        # Ignored files and environment variables
