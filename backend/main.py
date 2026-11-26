"""DocQ&A FastAPI application entrypoint and dependency composition root.

GET  /health                       : liveness & vector-store readiness probe
GET  /ready                        : strict readiness probe (vector store + API key)
POST /upload                       : PDF, TXT, MD -> validate -> extract -> chunk -> embed -> ChromaDB
GET  /documents                    : list indexed documents and chunk counts
DELETE /documents/{filename}       : remove a document's chunks from ChromaDB
POST /documents/{filename}/summarize : generate an AI executive summary briefing
POST /chat                         : question -> contextualize -> hybrid retrieve -> Gemini answer
"""

import logging
import time

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.middleware import (
    RequestContextMiddleware,
    SecurityHeadersMiddleware,
    SlidingWindowRateLimiter,
    extract_client_key,
)
from app.schemas import (
    ChatRequest,
    DeleteDocumentResponse,
    DocumentInfo,
    DocumentSummaryResponse,
    HealthResponse,
    UploadResponse,
)
from app.services.document_processor import (
    chunk_text,
    extract_document_text,
    sanitize_filename,
    validate_upload_bytes,
)
from app.services.llm_client import GeminiClient, to_http_error
from app.services.rag_service import NO_ANSWER, RAGService, compute_keyword_score
from app.services.vector_store import ChromaVectorStore

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("rag")

if not settings.api_key_configured:
    logger.warning("GEMINI_API_KEY is not configured - document indexing and chat will fail until set.")

# Service & repository singletons
vector_store = ChromaVectorStore(settings)
llm_client = GeminiClient(settings)
rag_service = RAGService(settings, vector_store, llm_client)
rate_limiter = SlidingWindowRateLimiter(
    max_requests=settings.rate_limit_requests,
    window_seconds=settings.rate_limit_window_seconds,
    enabled=settings.rate_limit_enabled,
)

# Backward-compatible module exports
collection = vector_store.collection
MAX_QUERY_CHARS = settings.max_query_chars
GENERATION_MODEL = settings.generation_model
MAX_DISTANCE = settings.max_distance
TOP_K = settings.top_k

app = FastAPI(title="DocQ&A Assistant RAG API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.allowed_origins),
    allow_credentials=settings.cors_allow_credentials,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Request-ID"],
)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RequestContextMiddleware)


def enforce_rate_limit(request: Request) -> None:
    """FastAPI dependency enforcing sliding-window rate limits per client IP."""
    rate_limiter.check(extract_client_key(request))


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    first_error = exc.errors()[0] if exc.errors() else {}
    msg = first_error.get("msg", "Invalid request body.")
    return JSONResponse(status_code=400, content={"detail": msg})


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail}, headers=exc.headers)


@app.get("/health", response_model=HealthResponse)
def health():
    vs_ready = vector_store.ping()
    return {
        "status": "ok" if vs_ready else "degraded",
        "gemini_configured": settings.api_key_configured,
        "vector_store_ready": vs_ready,
        "generation_model": settings.generation_model,
    }


@app.get("/ready")
def readiness():
    vs_ready = vector_store.ping()
    ready = vs_ready and settings.api_key_configured
    status_code = 200 if ready else 503
    return JSONResponse(
        status_code=status_code,
        content={
            "ready": ready,
            "vector_store_ready": vs_ready,
            "gemini_configured": settings.api_key_configured,
        },
    )


@app.post("/upload", response_model=UploadResponse, dependencies=[Depends(enforce_rate_limit)])
def upload(file: UploadFile = File(...)):
    raw_name = file.filename or ""
    clean_name = sanitize_filename(raw_name)
    lower_name = clean_name.lower()
    if not any(lower_name.endswith(ext) for ext in (".pdf", ".txt", ".md", ".markdown")):
        raise HTTPException(400, "Supported formats: PDF, TXT, and Markdown (.md).")

    max_bytes = settings.max_upload_mb * 1024 * 1024
    contents = file.file.read(max_bytes + 1)
    if len(contents) > max_bytes:
        raise HTTPException(413, f"File exceeds maximum upload size of {settings.max_upload_mb} MB.")

    filename = validate_upload_bytes(raw_name, contents)
    llm_client.require_api_key()

    started_at = time.perf_counter()
    text = extract_document_text(filename, contents)
    extracted_at = time.perf_counter()

    chunks = chunk_text(text, chunk_size=settings.chunk_size, overlap=settings.chunk_overlap)
    if not chunks:
        raise HTTPException(422, "No extractable text found in this document.")

    try:
        embeddings = llm_client.embed_texts(chunks, "retrieval_document")
    except Exception as exc:
        logger.exception("Embedding failed for %s", filename)
        raise to_http_error(exc, "Embedding") from exc
    embedded_at = time.perf_counter()

    vector_store.upsert_document(filename, chunks, embeddings)
    completed_at = time.perf_counter()

    logger.info(
        "Ingested %s: %d chunks; extraction %.2fs, embedding %.2fs, storage %.2fs, total %.2fs",
        filename,
        len(chunks),
        extracted_at - started_at,
        embedded_at - extracted_at,
        completed_at - embedded_at,
        completed_at - started_at,
    )
    return {"message": "Upload successful", "filename": filename, "chunks_processed": len(chunks)}


@app.get("/documents", response_model=list[DocumentInfo])
def get_documents():
    """List all indexed documents and their chunk counts."""
    return vector_store.list_documents()


@app.delete("/documents/{filename:path}", response_model=DeleteDocumentResponse)
def delete_document(filename: str):
    """Delete all chunks belonging to a document from ChromaDB."""
    clean_name = sanitize_filename(filename)
    deleted_count = vector_store.delete_document(clean_name)
    if deleted_count == 0:
        raise HTTPException(404, f"No document found with name '{clean_name}'.")
    return {
        "message": "Document deleted successfully",
        "filename": clean_name,
        "chunks_deleted": deleted_count,
    }


@app.post("/chat", dependencies=[Depends(enforce_rate_limit)])
def chat(request: ChatRequest):
    return rag_service.answer_question(request)


@app.post(
    "/documents/{filename:path}/summarize",
    response_model=DocumentSummaryResponse,
    dependencies=[Depends(enforce_rate_limit)],
)
def summarize_document(filename: str):
    """Generate an executive-grade AI briefing and summary for an indexed document."""
    return rag_service.summarize_document(filename)


__all__ = [
    "app",
    "sanitize_filename",
    "NO_ANSWER",
    "compute_keyword_score",
    "chunk_text",
    "MAX_QUERY_CHARS",
    "GENERATION_MODEL",
    "collection",
    "vector_store",
    "llm_client",
    "rag_service",
    "rate_limiter",
]
