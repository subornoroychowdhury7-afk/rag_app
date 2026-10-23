"""RAG backend.

POST /upload                     : PDF, TXT, MD -> text -> chunks -> embeddings -> ChromaDB
GET  /documents                  : list indexed documents and chunk counts
DELETE /documents/{filename}     : remove a document's chunks from ChromaDB
POST /documents/{filename}/summarize : generate an AI executive summary briefing
POST /chat                       : question -> embedding -> top-K chunks -> Gemini answer
GET  /health                     : service health status
"""

import base64
import json
import logging
import os
import time
import urllib.error
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

import chromadb
import google.generativeai as genai
import pymupdf as fitz
import pytesseract
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from google.api_core import exceptions as gexc
from pydantic import BaseModel, Field

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
load_dotenv()

logger = logging.getLogger("rag")
logging.basicConfig(level=logging.INFO)

GEMINI_API_KEY = (os.getenv("GEMINI_API_KEY") or "").strip()
API_KEY_OK = bool(GEMINI_API_KEY) and not GEMINI_API_KEY.startswith("your_")
if not API_KEY_OK:
    logger.warning("GEMINI_API_KEY is not configured - document indexing and chat will fail until set.")

genai.configure(api_key=GEMINI_API_KEY)

# Embedding model and dimensions
EMBEDDING_MODEL = (os.getenv("EMBEDDING_MODEL") or "models/gemini-embedding-2").strip()
EMBEDDING_DIM = int((os.getenv("EMBEDDING_DIM") or "768").strip())

# Generation model
GENERATION_MODEL = (os.getenv("GENERATION_MODEL") or "gemini-2.5-flash").strip()
generation_model = genai.GenerativeModel(GENERATION_MODEL)

CHUNK_SIZE = int((os.getenv("CHUNK_SIZE") or "1800").strip())
CHUNK_OVERLAP = int((os.getenv("CHUNK_OVERLAP") or "180").strip())
TOP_K = 5

# Cosine distance cutoff (0 = identical, ~1 = unrelated).
MAX_DISTANCE = float((os.getenv("MAX_DISTANCE") or "0.65").strip())

MAX_UPLOAD_MB = int((os.getenv("MAX_UPLOAD_MB") or "20").strip())
MAX_QUERY_CHARS = 2000
MAX_HISTORY_ITEMS = 30
MAX_RETRIES = 4

NO_ANSWER = "I cannot answer this based on the uploaded documents."

PROMPT_TEMPLATE = """You are a helpful and precise assistant. Answer the user's question using ONLY the provided context.
If the answer is not in the context, say 'I cannot answer this based on the uploaded documents.'
Do not use outside knowledge.

Context:
{context_string}

User Question: {query}

Guidelines:
- Give a direct, well-structured answer with clean formatting (bullet points, bold highlights) where appropriate.
- If the question can be answered from context, you may optionally append 2 to 3 concise, relevant follow-up questions the user might want to explore, in this exact format at the very end:
FOLLOW_UPS:
- [Follow-up question 1]?
- [Follow-up question 2]?
"""

# --------------------------------------------------------------------------- #
# Vector Store Setup
# --------------------------------------------------------------------------- #
CHROMA_API_KEY = (os.getenv("CHROMA_API_KEY") or "").strip()
if CHROMA_API_KEY:
    chroma_client = chromadb.CloudClient(
        tenant=os.getenv("CHROMA_TENANT"),
        database=os.getenv("CHROMA_DATABASE"),
        api_key=CHROMA_API_KEY,
    )
    index_config = {"spann": {"space": "cosine"}}
    logger.info("Using Chroma Cloud")
else:
    chroma_path = (os.getenv("CHROMA_PATH") or "./chroma_db").strip()
    os.makedirs(os.path.abspath(chroma_path), exist_ok=True)
    chroma_client = chromadb.PersistentClient(path=chroma_path)
    index_config = {"hnsw": {"space": "cosine"}}
    logger.info("Using local ChromaDB at %s", chroma_path)

try:
    collection = chroma_client.get_or_create_collection(name="rag_collection", configuration=index_config)
except Exception:
    logger.warning("Could not apply cosine index config; falling back to ChromaDB defaults.", exc_info=True)
    collection = chroma_client.get_or_create_collection(name="rag_collection")

# --------------------------------------------------------------------------- #
# FastAPI Application & Middleware
# --------------------------------------------------------------------------- #
app = FastAPI(title="DocQ&A API", version="1.0.0")

raw_origins = os.getenv("ALLOWED_ORIGINS", "*").strip()
if raw_origins == "*":
    origins = ["*"]
else:
    origins = [o.strip().rstrip("/") for o in raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False if origins == ["*"] else True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_request: Request, exc: RequestValidationError):
    errors = [f"{err.get('loc', ['body'])[-1]}: {err.get('msg', 'invalid value')}" for err in exc.errors()]
    detail = "; ".join(errors) if errors else "Invalid request payload."
    return JSONResponse(status_code=400, content={"detail": detail})


@app.exception_handler(Exception)
async def global_exception_handler(_request: Request, exc: Exception):
    if isinstance(exc, HTTPException):
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    logger.exception("Unhandled server exception: %s", exc)
    return JSONResponse(status_code=500, content={"detail": "An internal server error occurred."})


# --------------------------------------------------------------------------- #
# Request Models & Input Validation
# --------------------------------------------------------------------------- #
class Message(BaseModel):
    role: str = Field(..., max_length=20)
    content: str = Field(..., max_length=MAX_QUERY_CHARS * 2)


class ChatRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=MAX_QUERY_CHARS)
    history: list[Message] = Field(default_factory=list)
    doc_filter: Optional[str] = None


def sanitize_filename(raw_name: str) -> str:
    """Sanitize filename to prevent path traversal and invalid characters."""
    clean = os.path.basename(raw_name.strip())
    clean = "".join(ch for ch in clean if ch.isprintable() and ch not in ('\0', '\r', '\n'))
    clean = clean.strip()
    if not clean or clean in (".", ".."):
        raise HTTPException(400, "Invalid file name.")
    return clean


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 200) -> list[str]:
    """Split text into overlapping windows."""
    if chunk_size <= 0:
        raise ValueError("chunk_size must be a positive integer")
    if overlap < 0 or overlap >= chunk_size:
        raise ValueError("overlap must be >= 0 and smaller than chunk_size")

    text = text.strip()
    if not text:
        return []
    if len(text) <= chunk_size:
        return [text]

    step = chunk_size - overlap
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(text):
            break
        start += step
    return chunks


RETRYABLE = (
    gexc.ResourceExhausted,
    gexc.ServiceUnavailable,
    gexc.DeadlineExceeded,
    gexc.InternalServerError,
)


def call_gemini(fn, *args, **kwargs):
    """Call a Gemini SDK function with exponential backoff on retryable errors."""
    delay = 1.0
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return fn(*args, **kwargs)
        except RETRYABLE as exc:
            if attempt == MAX_RETRIES:
                raise
            logger.warning("Gemini %s (attempt %d/%d) - retrying in %.0fs",
                           type(exc).__name__, attempt, MAX_RETRIES, delay)
            time.sleep(delay)
            delay *= 2


def to_http_error(exc: Exception, action: str) -> HTTPException:
    """Translate a Gemini SDK failure into a structured HTTP exception."""
    if isinstance(exc, gexc.ResourceExhausted):
        return HTTPException(429, "The Gemini API rate limit or quota was reached. Please wait a moment and try again.")
    if isinstance(exc, (gexc.Unauthenticated, gexc.PermissionDenied)) or (
        isinstance(exc, gexc.InvalidArgument) and "API key" in str(exc)
    ):
        return HTTPException(500, "The Gemini API key is missing or invalid. Check GEMINI_API_KEY in environment variables.")
    if isinstance(exc, gexc.NotFound):
        return HTTPException(502, f"Gemini model not found. Check EMBEDDING_MODEL / GENERATION_MODEL. ({exc})")
    if isinstance(exc, (gexc.ServiceUnavailable, gexc.DeadlineExceeded, gexc.InternalServerError)):
        return HTTPException(503, "The Gemini API is temporarily unavailable. Please try again shortly.")
    return HTTPException(502, f"{action} failed: {exc}")


def require_api_key() -> None:
    if not API_KEY_OK:
        raise HTTPException(500, "GEMINI_API_KEY is not configured on the server.")


def embed_text(text: str, task_type: str = "retrieval_document") -> list[float]:
    result = call_gemini(
        genai.embed_content,
        model=EMBEDDING_MODEL,
        content=text,
        task_type=task_type,
        output_dimensionality=EMBEDDING_DIM,
    )
    return result["embedding"]


def embed_texts(texts: list[str], task_type: str = "retrieval_document") -> list[list[float]]:
    batches = [texts[i:i + 100] for i in range(0, len(texts), 100)]

    def embed_batch(batch: list[str]) -> list[list[float]]:
        result = call_gemini(
            genai.embed_content,
            model=EMBEDDING_MODEL,
            content=batch,
            task_type=task_type,
            output_dimensionality=EMBEDDING_DIM,
        )
        embeddings = result["embedding"]
        if len(embeddings) != len(batch):
            raise ValueError(f"Gemini returned {len(embeddings)} embeddings for {len(batch)} chunks.")
        return embeddings

    if len(batches) == 1:
        return embed_batch(batches[0])

    with ThreadPoolExecutor(max_workers=2) as executor:
        return [embedding for batch_result in executor.map(embed_batch, batches)
                for embedding in batch_result]


def ocr_pdf_with_gemini(contents: bytes) -> str:
    """Transcribe a scanned PDF through Gemini when local Tesseract is unavailable."""
    require_api_key()
    model = GENERATION_MODEL.removeprefix("models/")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    payload = {
        "contents": [{
            "parts": [
                {"text": "Transcribe all visible text in this PDF as faithfully as possible. "
                         "Preserve page order and paragraph breaks. Return only the transcription; "
                         "do not summarize or add commentary."},
                {"inlineData": {
                    "mimeType": "application/pdf",
                    "data": base64.b64encode(contents).decode("ascii"),
                }},
            ],
        }],
        "generationConfig": {"temperature": 0},
    }
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            result = json.loads(response.read())
    except urllib.error.HTTPError as exc:
        logger.exception("Gemini OCR request failed with HTTP %d", exc.code)
        if exc.code == 429:
            raise HTTPException(429, "The Gemini API rate limit or quota was reached during OCR.") from exc
        if exc.code in (401, 403):
            raise HTTPException(500, "The Gemini API key is missing, invalid, or not permitted for OCR.") from exc
        raise HTTPException(503, "Gemini OCR is temporarily unavailable. Please try again shortly.") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        logger.exception("Gemini OCR request failed")
        raise HTTPException(503, "Gemini OCR could not be reached. Please try again shortly.") from exc

    text = "\n".join(
        part["text"]
        for candidate in result.get("candidates", [])
        for part in candidate.get("content", {}).get("parts", [])
        if isinstance(part.get("text"), str)
    ).strip()
    if not text:
        raise HTTPException(422, "No text could be recognized in this PDF.")
    return text


def extract_pdf_text(contents: bytes) -> str:
    """Extract embedded text and OCR pages containing no selectable text."""
    from PIL import Image

    text_pages: list[str] = []
    document = None
    try:
        document = fitz.open(stream=contents, filetype="pdf")
        if document.needs_pass:
            raise HTTPException(400, "Encrypted PDFs are not supported.")
        if len(document) == 0:
            raise HTTPException(422, "The PDF file contains no pages.")
        for page_number, page in enumerate(document, start=1):
            page_text = page.get_text("text").strip()
            if page_text:
                text_pages.append(page_text)
                continue

            # Render at 200 DPI for optimal balance of OCR accuracy and performance
            pixmap = page.get_pixmap(matrix=fitz.Matrix(200 / 72, 200 / 72), alpha=False)
            image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
            page_text = pytesseract.image_to_string(image).strip()
            if page_text:
                text_pages.append(page_text)
            logger.info("OCR page %d/%d: %d characters", page_number, len(document), len(page_text))
    except HTTPException:
        raise
    except (fitz.FileDataError, fitz.EmptyFileError) as exc:
        raise HTTPException(400, f"Could not read PDF: {exc}") from exc
    except pytesseract.TesseractNotFoundError:
        logger.warning("Tesseract is unavailable; falling back to Gemini PDF transcription")
        return ocr_pdf_with_gemini(contents)
    except Exception as exc:
        logger.exception("PDF text extraction failed")
        raise HTTPException(422, f"Could not extract text from PDF: {exc}") from exc
    finally:
        if document is not None:
            document.close()
    return "\n".join(text_pages)


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #
@app.get("/health")
def health():
    return {
        "status": "ok",
        "gemini_configured": API_KEY_OK,
    }


@app.post("/upload")
def upload(file: UploadFile = File(...)):
    require_api_key()

    filename = sanitize_filename(file.filename or "")
    lower_name = filename.lower()
    valid_exts = (".pdf", ".txt", ".md", ".markdown")
    if not any(lower_name.endswith(ext) for ext in valid_exts):
        raise HTTPException(400, "Supported formats: PDF, TXT, and Markdown (.md).")

    max_bytes = MAX_UPLOAD_MB * 1024 * 1024
    contents = file.file.read(max_bytes + 1)
    if len(contents) > max_bytes:
        raise HTTPException(413, f"File exceeds maximum upload size of {MAX_UPLOAD_MB} MB.")
    if not contents:
        raise HTTPException(400, "The uploaded file is empty.")

    started_at = time.perf_counter()
    if lower_name.endswith((".txt", ".md", ".markdown")):
        try:
            text = contents.decode("utf-8").strip()
        except UnicodeDecodeError:
            text = contents.decode("utf-8", errors="replace").strip()
    else:
        text = extract_pdf_text(contents)
    extracted_at = time.perf_counter()

    chunks = chunk_text(text, chunk_size=CHUNK_SIZE, overlap=CHUNK_OVERLAP)
    if not chunks:
        raise HTTPException(422, "No extractable text found in this document.")

    try:
        embeddings = embed_texts(chunks, "retrieval_document")
    except Exception as exc:
        logger.exception("Embedding failed for %s", filename)
        raise to_http_error(exc, "Embedding") from exc
    embedded_at = time.perf_counter()

    # Replace previous version if re-uploaded
    try:
        previous = collection.get(where={"source": filename}, include=[])["ids"]
        if previous:
            collection.delete(ids=previous)
    except Exception as e:
        logger.warning("Could not check previous chunks for %s: %s", filename, e)

    collection.add(
        ids=[str(uuid.uuid4()) for _ in chunks],
        embeddings=embeddings,
        documents=chunks,
        metadatas=[{"source": filename, "chunk_index": i} for i in range(len(chunks))],
    )

    completed_at = time.perf_counter()
    logger.info(
        "Ingested %s: %d chunks; extraction %.2fs, embedding %.2fs, storage %.2fs, total %.2fs",
        filename, len(chunks), extracted_at - started_at, embedded_at - extracted_at,
        completed_at - embedded_at, completed_at - started_at,
    )
    return {"message": "Upload successful", "filename": filename, "chunks_processed": len(chunks)}


@app.get("/documents")
def get_documents():
    """List all indexed documents and their chunk counts."""
    try:
        results = collection.get(include=["metadatas"])
        metadatas = results.get("metadatas") or []
        docs = {}
        for meta in metadatas:
            source = (meta or {}).get("source", "unknown")
            docs[source] = docs.get(source, 0) + 1
        return [{"name": name, "chunks": count} for name, count in sorted(docs.items())]
    except Exception as e:
        logger.exception("Failed to fetch documents from ChromaDB: %s", e)
        return []


@app.delete("/documents/{filename:path}")
def delete_document(filename: str):
    """Remove a document's chunks from the vector store."""
    clean_name = sanitize_filename(filename)
    results = collection.get(where={"source": clean_name}, include=[])
    if not results.get("ids"):
        raise HTTPException(404, f"No document found with name '{clean_name}'.")
    collection.delete(ids=results["ids"])
    logger.info("Deleted %d chunks for %s", len(results["ids"]), clean_name)
    return {"message": "Document deleted", "filename": clean_name, "chunks_deleted": len(results["ids"])}


@app.post("/chat")
def chat(request: ChatRequest):
    query = request.query.strip()
    if not query:
        raise HTTPException(400, "Query must not be empty.")
    if len(query) > MAX_QUERY_CHARS:
        raise HTTPException(400, f"Query is too long (limit is {MAX_QUERY_CHARS} characters).")
    require_api_key()

    # Determine filter: all documents or restricted to specific document
    where_filter = None
    if request.doc_filter and request.doc_filter.strip():
        filter_name = sanitize_filename(request.doc_filter)
        where_filter = {"source": filter_name}

    if where_filter:
        total = len(collection.get(where=where_filter, include=[])["ids"])
    else:
        total = collection.count()

    if total == 0:
        return {
            "answer": NO_ANSWER,
            "sources": [],
            "source_files": [],
            "citations": [],
            "suggested_followups": [],
        }

    try:
        query_vector = embed_text(query, "retrieval_query")
    except Exception as exc:
        logger.exception("Query embedding failed")
        raise to_http_error(exc, "Embedding") from exc

    query_kwargs = {
        "query_embeddings": [query_vector],
        "n_results": min(TOP_K, total),
        "include": ["documents", "distances", "metadatas"],
    }
    if where_filter:
        query_kwargs["where"] = where_filter

    results = collection.query(**query_kwargs)
    distances: list[float] = results["distances"][0] if results.get("distances") else []
    docs: list[str] = results["documents"][0] if results.get("documents") else []
    metadatas: list[dict] = results["metadatas"][0] if results.get("metadatas") else []

    logger.info("Retrieval distances (cutoff %.2f): %s", MAX_DISTANCE, [round(d, 3) for d in distances])

    citations = []
    for doc, meta, dist in zip(docs, metadatas, distances):
        if dist <= MAX_DISTANCE:
            source_name = (meta or {}).get("source", "Document")
            chunk_idx = (meta or {}).get("chunk_index", 0)
            relevance = max(10, min(99, round((1.0 - dist) * 100)))
            citations.append({
                "text": doc,
                "source": source_name,
                "relevance": relevance,
                "chunk_index": chunk_idx,
            })

    retrieved_chunks = [c["text"] for c in citations]
    source_files = sorted(list({c["source"] for c in citations}))

    if not retrieved_chunks:
        return {
            "answer": NO_ANSWER,
            "sources": [],
            "source_files": [],
            "citations": [],
            "suggested_followups": [],
        }

    context_string = "\n\n---\n\n".join(retrieved_chunks)
    prompt = PROMPT_TEMPLATE.format(context_string=context_string, query=query)

    # Limit history to prevent excessive context blowup
    gemini_history = []
    recent_history = request.history[-MAX_HISTORY_ITEMS:]
    for msg in recent_history:
        role = "model" if msg.role == "assistant" else "user"
        gemini_history.append({"role": role, "parts": [msg.content]})

    try:
        chat_session = generation_model.start_chat(history=gemini_history)
        response = call_gemini(chat_session.send_message, prompt)
        answer = response.text
    except ValueError as exc:
        logger.warning("Response blocked or empty: %s", exc)
        raise HTTPException(502, "The model returned no answer (blocked or empty). Try rephrasing your question.") from exc
    except Exception as exc:
        logger.exception("Generation failed")
        raise to_http_error(exc, "Generation") from exc

    suggested_followups: list[str] = []
    if "FOLLOW_UPS:" in answer:
        parts = answer.split("FOLLOW_UPS:")
        answer = parts[0].strip()
        for line in parts[1].splitlines():
            cleaned = line.strip().lstrip("-*•0123456789. ")
            if len(cleaned) > 5:
                suggested_followups.append(cleaned)
        suggested_followups = suggested_followups[:3]

    return {
        "answer": answer,
        "sources": retrieved_chunks,
        "source_files": source_files,
        "citations": citations,
        "suggested_followups": suggested_followups,
    }


@app.post("/documents/{filename:path}/summarize")
def summarize_document(filename: str):
    """Generate an executive-grade AI briefing and summary for an indexed document."""
    clean_name = sanitize_filename(filename)
    require_api_key()

    results = collection.get(where={"source": clean_name}, include=["documents", "metadatas"])
    docs = results.get("documents") or []
    if not docs:
        raise HTTPException(404, f"No content found for document '{clean_name}'.")

    metas = results.get("metadatas") or []
    indexed_docs = []
    for doc, meta in zip(docs, metas):
        idx = (meta or {}).get("chunk_index", 0)
        indexed_docs.append((idx, doc))
    indexed_docs.sort(key=lambda x: x[0])
    combined_text = "\n\n".join(t for _, t in indexed_docs)

    text_sample = combined_text[:40000]

    summary_prompt = f"""You are an expert executive research analyst. Generate a comprehensive, professional executive briefing based ONLY on the provided document text.

Format your output in clean, elegant Markdown using the following four sections:

### 📌 Executive Overview
A concise paragraph synthesizing the primary objective, context, and core thesis of the document.

### 💡 Key Highlights & Critical Data
- 3 to 5 bullet points highlighting the most significant findings, metrics, dates, or qualitative insights.

### 🎯 Strategic Takeaways & Recommendations
- 2 to 4 actionable conclusions, key risks, or next steps outlined or implied by the document.

### ❓ Recommended Follow-up Inquiries
- 3 thoughtful questions an analyst or executive should explore next based on this document.

Document Name: {clean_name}
Document Content:
{text_sample}
"""

    try:
        response = call_gemini(generation_model.generate_content, summary_prompt)
        summary_md = response.text
    except Exception as exc:
        logger.exception("Summarization failed for %s", clean_name)
        raise to_http_error(exc, "Summarization") from exc

    return {
        "filename": clean_name,
        "summary": summary_md,
        "total_chunks": len(docs),
    }
