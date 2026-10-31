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
import re
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

# Primary Generation model: Gemini 3.8 Flash Lite
GENERATION_MODEL = (os.getenv("GENERATION_MODEL") or "gemini-3.8-flash-lite").strip()
GENERATION_TEMPERATURE = float((os.getenv("GENERATION_TEMPERATURE") or "0.2").strip())

# Generation config: high token limit + low temperature for grounded, precise, high-accuracy answers
_generation_config = genai.types.GenerationConfig(
    max_output_tokens=8192,
    temperature=GENERATION_TEMPERATURE,
    top_p=0.95,
)

CHUNK_SIZE = int((os.getenv("CHUNK_SIZE") or "1800").strip())
CHUNK_OVERLAP = int((os.getenv("CHUNK_OVERLAP") or "300").strip())
TOP_K = int((os.getenv("TOP_K") or "12").strip())                  # Retrieve 12 chunks for comprehensive context

# Cosine distance cutoff (0 = identical, ~1 = unrelated).
# 0.78 is permissive so borderline-relevant chunks aren't discarded before hybrid re-ranking.
MAX_DISTANCE = float((os.getenv("MAX_DISTANCE") or "0.78").strip())

MAX_UPLOAD_MB = int((os.getenv("MAX_UPLOAD_MB") or "20").strip())
MAX_QUERY_CHARS = int((os.getenv("MAX_QUERY_CHARS") or "10000").strip())
MAX_HISTORY_ITEMS = int((os.getenv("MAX_HISTORY_ITEMS") or "100").strip())
MAX_RETRIES = 4

NO_ANSWER = "I cannot answer this based on the uploaded documents."

MODE_INSTRUCTIONS = {
    "detailed": (
        "ANSWER STYLE: IN-DEPTH & THOROUGH (Default)\n"
        "- Provide a comprehensive, multi-faceted analysis with rich supporting evidence.\n"
        "- Organize your explanation with clear Markdown headings (##, ###).\n"
        "- Include relevant quantitative figures, technical mechanisms, and criteria found in the context.\n"
        "- Use markdown comparison tables (| Col 1 | Col 2 |) whenever comparing tools, options, or metrics."
    ),
    "concise": (
        "ANSWER STYLE: EXECUTIVE & CONCISE\n"
        "- Deliver a rapid, high-impact executive summary.\n"
        "- Lead with the bottom-line takeaway in 1 sentence, followed by 3-5 crisp bullet points.\n"
        "- Focus strictly on actionable outcomes, key figures, and core findings."
    ),
    "academic": (
        "ANSWER STYLE: ACADEMIC & TECHNICAL\n"
        "- Adopt a formal, rigorous scholarly tone.\n"
        "- Provide complete mathematical formulations in LaTeX, explicit assumptions, and methodological evaluation.\n"
        "- Structure arguments methodically, highlighting evidence strength and potential boundary conditions."
    ),
    "step_by_step": (
        "ANSWER STYLE: STEP-BY-STEP PROCEDURAL GUIDE\n"
        "- Format the answer as a clear sequential guide with numbered steps (1., 2., 3.).\n"
        "- Detail any prerequisites, specific execution steps, and verification checkpoints."
    ),
}

PROMPT_TEMPLATE = """You are DocQ&A Assistant, an elite frontier research AI powered by advanced deep thinking and rigorous analytical reasoning. \
Your objective is to deliver the highest-intelligence, deeply grounded, mathematically and technically rigorous answer possible, \
grounded STRICTLY in the provided context excerpts from the user's uploaded documents.

CONTEXT EXCERPTS FROM UPLOADED DOCUMENTS:
{context_string}

USER QUESTION: {query}

{mode_instruction}

DEEP REASONING & THINKING PROTOCOL:
Before writing your final response, you MUST first execute an internal thinking and verification phase enclosed within <thinking>...</thinking> tags:
1. DECONSTRUCT QUESTION: Identify explicit questions, implicit sub-problems, and key technical criteria.
2. EVIDENCE AUDIT: Scan the provided context excerpts, extract exact figures, formulas, and facts, and cross-reference multiple passages.
3. LOGICAL REASONING: Synthesize disparate data points, evaluate edge cases, and structure an authoritative, step-by-step or comparative analysis.
4. GROUNDING & CITATION CHECK: Ensure every key factual statement is strictly backed by an excerpt, citing `[DocumentName.pdf]`.

CORE ANSWER STANDARDS:
1. EXECUTIVE CLARITY & DIRECTNESS:
   - Begin with a direct, high-impact answer to the user's question in the first 1-2 sentences.
   - Do NOT begin with meta-commentary like "Based on the provided excerpts..." or "According to the context...". Answer with natural authority.

2. DEPTH & RIGOR:
   - Elaborate thoroughly. Do not give a superficial or short response if the context contains rich details, nuances, figures, or explanations.
   - Synthesize information across multiple excerpts or documents into a coherent narrative.

3. INLINE GROUNDED CITATIONS:
   - Whenever stating a key fact, metric, formula, or finding, attribute it inline using the document name and excerpt number in brackets: e.g. `[DocumentName.pdf]` or `[DocumentName.pdf, Excerpt 1]`.
   - This provides verifiable proof for every statement.

4. STRUCTURE & TYPOGRAPHY:
   - Use Markdown headings (##, ###) to organize distinct sections.
   - Use comparison tables (`| Item | Description | Metric |`) when contrasting data points, alternatives, or features.
   - Use bullet points for itemized properties, criteria, or lists.
   - Use numbered steps for sequential workflows, chronological events, or algorithms.
   - Use **bold** typography for key terms, definitions, and critical metrics.

5. MATHEMATICS, FORMULAS & CODE:
   - Format ALL mathematical symbols, variables, and expressions using LaTeX: inline as $...$ and display equations as $$...$$.
   - Explicitly define all variables and show step-by-step mathematical reasoning.
   - Format code blocks, commands, and structured configurations in syntax-highlighted code blocks (e.g. ```python, ```bash, ```json).

6. HONEST LIMITS & PARTIAL ANSWERS:
   - If the context answers only part of the question, answer what you can with citations, and explicitly state what specific information is not covered in the excerpts.
   - If the provided context contains absolutely NO relevant information to answer the question, state exactly:
     'I cannot answer this based on the uploaded documents.'

At the very end of your answer, if the question was answerable, append EXACTLY this block:
FOLLOW_UPS:
- [Contextually relevant follow-up question 1]?
- [Contextually relevant follow-up question 2]?
- [Contextually relevant follow-up question 3]?
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
    collection = chroma_client.get_or_create_collection(name="rag_collection")


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def sanitize_filename(filename: str) -> str:
    """Strip path traversal components and normalise filename."""
    base = os.path.basename(filename)
    return re.sub(r"[^\w\.\-\s]", "_", base).strip()


def extract_pdf_text(contents: bytes) -> str:
    """Extract text from PDF bytes; falls back to OCR if fewer than 50 chars extracted."""
    doc = fitz.open(stream=contents, filetype="pdf")
    pages = []
    for page in doc:
        pages.append(page.get_text() or "")
    text = "\n".join(pages).strip()

    if len(text) < 50:
        logger.info("Direct text extraction yielded %d chars - falling back to OCR", len(text))
        ocr_pages = []
        for page in doc:
            pix = page.get_pixmap()
            try:
                from PIL import Image
                import io
                img = Image.open(io.BytesIO(pix.tobytes("png")))
                ocr_text = pytesseract.image_to_string(img)
                ocr_pages.append(ocr_text)
            except Exception as exc:
                logger.warning("OCR failed on a page: %s", exc)
        ocr_combined = "\n".join(ocr_pages).strip()
        if ocr_combined:
            text = ocr_combined

    doc.close()
    return text


def chunk_text(text: str, chunk_size: int = 1800, overlap: int = 300) -> list[str]:
    """Semantic recursive chunking that respects paragraph, sentence, and phrase boundaries."""
    if not text or not text.strip():
        return []

    separators = ["\n\n", "\n", ". ", "; ", ", ", " "]

    def _split(txt: str, sep_idx: int) -> list[str]:
        if sep_idx >= len(separators):
            step = chunk_size - overlap
            return [txt[i:i + chunk_size] for i in range(0, len(txt), step)]

        sep = separators[sep_idx]
        if sep == "":
            step = chunk_size - overlap
            return [txt[i:i + chunk_size] for i in range(0, len(txt), step)]

        splits = txt.split(sep)
        result = []
        for i, s in enumerate(splits):
            suffix = sep if i < len(splits) - 1 else ""
            s_full = s + suffix
            if not s_full.strip():
                continue
            if len(s_full) <= chunk_size:
                result.append(s_full)
            else:
                result.extend(_split(s_full, sep_idx + 1))
        return result

    pieces = _split(text, 0)
    chunks = []
    current_docs = []
    current_len = 0

    for piece in pieces:
        piece_len = len(piece)
        if current_len + piece_len <= chunk_size:
            current_docs.append(piece)
            current_len += piece_len
        else:
            if current_docs:
                merged = "".join(current_docs).strip()
                if merged:
                    chunks.append(merged)
                overlap_docs = []
                overlap_len = 0
                for d in reversed(current_docs):
                    if overlap_len + len(d) <= overlap:
                        overlap_docs.insert(0, d)
                        overlap_len += len(d)
                    else:
                        break
                current_docs = overlap_docs + [piece]
                current_len = sum(len(d) for d in current_docs)
            else:
                chunks.append(piece.strip())
                current_docs = []
                current_len = 0

    if current_docs:
        merged = "".join(current_docs).strip()
        if merged and (not chunks or chunks[-1] != merged):
            chunks.append(merged)

    return chunks


def compute_keyword_score(query: str, text: str) -> float:
    """Calculate term frequency & exact phrase matching score between query and chunk."""
    stopwords = {
        "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "he",
        "in", "is", "it", "its", "of", "on", "that", "the", "to", "was", "were",
        "will", "with", "what", "how", "why", "who", "which", "when", "can", "could",
        "would", "should", "does", "do", "tell", "me", "about", "give", "i", "you"
    }
    tokens = [t.lower() for t in re.findall(r"\b[A-Za-z0-9_\-\.]{2,}\b", query) if t.lower() not in stopwords]
    if not tokens:
        return 0.0

    text_lower = text.lower()
    total_weight = 0.0
    matched_weight = 0.0

    clean_query = " ".join(tokens)
    if len(tokens) >= 2 and clean_query in text_lower:
        matched_weight += 2.5
        total_weight += 2.5

    for token in set(tokens):
        is_num = any(c.isdigit() for c in token)
        is_acronym = token.upper() in query and len(token) >= 2
        weight = 2.0 if (is_num or is_acronym) else 1.0
        total_weight += weight

        count = len(re.findall(r"\b" + re.escape(token) + r"\b", text_lower))
        if count > 0:
            matched_weight += weight * min(1.0 + 0.25 * (count - 1), 1.75)

    return min(1.0, matched_weight / max(total_weight, 1.0))


def contextualize_query(query: str, history: list) -> str:
    """Rewrite follow-up questions to be self-contained for accurate vector retrieval."""
    if not history or not API_KEY_OK:
        return query

    recent = history[-8:]
    ambiguous_indicators = {
        "it", "this", "that", "these", "those", "they", "them", "their", "its",
        "he", "she", "his", "her", "why", "how", "what about", "and", "explain more",
        "elaborate", "tell me more", "summarize", "difference", "compare", "step",
        "earlier", "previous", "above", "mentioned"
    }
    words = set(re.findall(r"\b\w+\b", query.lower()))
    is_likely_followup = bool(words & ambiguous_indicators) or len(query.split()) <= 4
    if not is_likely_followup:
        return query

    history_text = "\n".join(f"{m.role}: {m.content[:500]}" for m in recent)
    prompt = (
        "Given the conversation history and the user's latest follow-up question, rewrite the question "
        "into a single, standalone search query that includes all relevant subjects, entities, and context "
        "needed to retrieve relevant document excerpts.\n"
        "Do NOT answer the question. Return ONLY the rewritten query text without explanation.\n\n"
        f"Conversation History:\n{history_text}\n\n"
        f"Latest Question: {query}\n"
        "Standalone Search Query:"
    )

    try:
        res_text, _ = generate_with_gemini(prompt, [])
        rewritten = res_text.strip().strip('"\'')
        if rewritten and len(rewritten) > 3 and not rewritten.lower().startswith("i cannot"):
            return rewritten
    except Exception as e:
        logger.debug("Gemini query rewriting skipped: %s", e)

    return query


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


def generate_with_gemini(prompt: str, gemini_history: list[dict]) -> tuple[str, str]:
    """Call Google Gemini with automatic fallback across known Gemini flash lite and flash models.

    Primary: gemini-3.8-flash-lite. If Google returns 404/Not Found for the model name,
    it automatically falls back to other known Gemini flash models.
    """
    configured_model = GENERATION_MODEL.strip()
    if not configured_model:
        configured_model = "gemini-3.8-flash-lite"

    candidates = [
        configured_model,
        "gemini-3.8-flash-lite",
        "gemini-3.8-flash",
        "gemini-3.5-flash-lite",
        "gemini-2.5-flash",
        "gemini-1.5-flash",
    ]
    seen = set()
    models_to_try = []
    for m in candidates:
        if m and m not in seen:
            seen.add(m)
            models_to_try.append(m)

    last_exc = None
    for m_name in models_to_try:
        try:
            logger.info("Calling Gemini model: %s", m_name)
            gm = genai.GenerativeModel(m_name, generation_config=_generation_config)
            chat_session = gm.start_chat(history=gemini_history)
            response = call_gemini(chat_session.send_message, prompt)
            return response.text, m_name
        except Exception as exc:
            if isinstance(exc, gexc.NotFound) or "404" in str(exc) or "not found" in str(exc).lower():
                logger.warning("Gemini model '%s' not found (%s) — trying next candidate...", m_name, exc)
                last_exc = exc
                continue
            raise

    if last_exc:
        raise to_http_error(last_exc, "Generation") from last_exc
    raise HTTPException(502, "All Gemini generation models failed.")


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
    """Embed texts concurrently in batches of 20 with up to 5 worker threads."""
    batch_size = 20
    batches = [texts[i:i + batch_size] for i in range(0, len(texts), batch_size)]

    def _embed_batch(batch: list[str]) -> list[list[float]]:
        result = call_gemini(
            genai.embed_content,
            model=EMBEDDING_MODEL,
            content=batch,
            task_type=task_type,
            output_dimensionality=EMBEDDING_DIM,
        )
        return result["embedding"]

    all_embeddings: list[list[float]] = []
    with ThreadPoolExecutor(max_workers=min(5, len(batches) or 1)) as executor:
        for batch_embeddings in executor.map(_embed_batch, batches):
            all_embeddings.extend(batch_embeddings)
    return all_embeddings


# --------------------------------------------------------------------------- #
# FastAPI App & Endpoints
# --------------------------------------------------------------------------- #
app = FastAPI(title="DocQ&A Assistant RAG API")

ALLOWED_ORIGINS = [
    o.strip()
    for o in (os.getenv("ALLOWED_ORIGINS") or "*").split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    first_error = exc.errors()[0] if exc.errors() else {}
    msg = first_error.get("msg", "Invalid request body.")
    return JSONResponse(status_code=400, content={"detail": msg})


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.get("/health")
def health():
    return {
        "status": "ok",
        "gemini_configured": API_KEY_OK,
        "generation_model": GENERATION_MODEL,
    }


@app.post("/upload")
def upload(file: UploadFile = File(...)):
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

    require_api_key()

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
        logger.warning("Failed to retrieve documents: %s", e)
        return []


@app.delete("/documents/{filename:path}")
def delete_document(filename: str):
    """Delete all chunks belonging to a document from ChromaDB."""
    clean_name = sanitize_filename(filename)
    results = collection.get(where={"source": clean_name}, include=[])
    doc_ids = results.get("ids") or []
    if not doc_ids:
        raise HTTPException(404, f"No document found with name '{clean_name}'.")

    collection.delete(ids=doc_ids)
    logger.info("Deleted %d chunks for '%s'", len(doc_ids), clean_name)
    return {"message": "Document deleted successfully", "filename": clean_name, "chunks_deleted": len(doc_ids)}


class Message(BaseModel):
    role: str
    content: str = Field(..., max_length=32000)


class ChatRequest(BaseModel):
    query: str
    history: list[Message] = Field(default_factory=list)
    doc_filter: Optional[str] = None
    mode: Optional[str] = "detailed"


@app.post("/chat")
def chat(request: ChatRequest):
    query = request.query.strip()
    if not query:
        raise HTTPException(400, "Query must not be empty.")
    if len(query) > MAX_QUERY_CHARS:
        raise HTTPException(400, f"Query is too long (limit is {MAX_QUERY_CHARS} characters).")
    require_api_key()

    where_filter = None
    if request.doc_filter and request.doc_filter.strip():
        filter_name = sanitize_filename(request.doc_filter)
        where_filter = {"source": filter_name}

    if where_filter:
        total = len(collection.get(where=where_filter, include=[])["ids"])
    else:
        total = collection.count()

    greeting_regex = re.compile(
        r"^(hi|hello|hey|greetings|good\s+(morning|afternoon|evening))\b|"
        r"\b(who\s+are\s+you|what\s+can\s+you\s+do|how\s+can\s+you\s+help|what\s+is\s+this\s+app)\b|"
        r"\b(what\s+documents|list\s+documents|which\s+files|show\s+documents|what\s+do\s+you\s+know)\b|"
        r"\b(help|how\s+to\s+use)\b",
        re.IGNORECASE,
    )

    if total == 0:
        if greeting_regex.search(query):
            return {
                "answer": (
                    "Hello! I am your **DocQ&A Assistant**. You currently do not have any documents indexed. "
                    "Please upload a PDF, Markdown, or text file using the sidebar to begin asking questions!"
                ),
                "sources": [],
                "source_files": [],
                "citations": [],
                "suggested_followups": [],
                "model_used": "system",
            }
        return {
            "answer": NO_ANSWER,
            "sources": [],
            "source_files": [],
            "citations": [],
            "suggested_followups": [],
            "model_used": "system",
        }

    search_query = contextualize_query(query, request.history)

    try:
        query_vector = embed_text(search_query, "retrieval_query")
    except Exception as exc:
        logger.exception("Query embedding failed")
        raise to_http_error(exc, "Embedding") from exc

    candidate_k = min(TOP_K * 2, total)
    query_kwargs = {
        "query_embeddings": [query_vector],
        "n_results": candidate_k,
        "include": ["documents", "distances", "metadatas"],
    }
    if where_filter:
        query_kwargs["where"] = where_filter

    results = collection.query(**query_kwargs)
    distances: list[float] = results["distances"][0] if results.get("distances") else []
    docs: list[str] = results["documents"][0] if results.get("documents") else []
    metadatas: list[dict] = results["metadatas"][0] if results.get("metadatas") else []

    scored_candidates = []
    for doc, meta, dist in zip(docs, metadatas, distances):
        source_name = (meta or {}).get("source", "Document")
        chunk_idx = (meta or {}).get("chunk_index", 0)
        vec_sim = max(0.0, 1.0 - dist)
        kw_sim = compute_keyword_score(search_query, doc)

        if kw_sim > 0:
            composite_score = 0.65 * vec_sim + 0.35 * kw_sim
        else:
            composite_score = 0.85 * vec_sim

        effective_cutoff = MAX_DISTANCE + (0.08 if kw_sim > 0.3 else 0.0)
        if dist <= effective_cutoff:
            relevance = max(15, min(99, round(composite_score * 100)))
            scored_candidates.append({
                "text": doc,
                "source": source_name,
                "chunk_index": chunk_idx,
                "relevance": relevance,
                "composite_score": composite_score,
                "dist": dist,
            })

    scored_candidates.sort(key=lambda x: x["composite_score"], reverse=True)
    citations = scored_candidates[:TOP_K]

    retrieved_chunks = [c["text"] for c in citations]
    source_files = sorted(list({c["source"] for c in citations}))

    if not retrieved_chunks:
        if greeting_regex.search(query):
            doc_items = get_documents()
            if doc_items:
                doc_summary = "\n".join(f"- **{d['name']}** ({d['chunks']} indexed passages)" for d in doc_items)
                greeting_answer = (
                    f"Hello! I am your **DocQ&A Assistant**, ready to help you analyze and extract verified insights "
                    f"from your knowledge base.\n\n"
                    f"### 📚 Available Documents ({len(doc_items)} total):\n"
                    f"{doc_summary}\n\n"
                    f"### 💡 What I Can Help You With:\n"
                    f"- **In-depth Q&A**: Ask targeted questions and get comprehensive answers with inline citations `[DocumentName.pdf]`.\n"
                    f"- **Cross-Document Synthesis**: Compare findings, metrics, and arguments across multiple files.\n"
                    f"- **Technical & Mathematical Reasoning**: Step-by-step problem solving with clean LaTeX formulas ($E=mc^2$).\n"
                    f"- **Executive Briefings**: Summaries, data tables, and structured procedural guides.\n\n"
                    f"Try asking a question about any of your documents above to begin!"
                )
                sample_followups = [
                    f"What are the key findings in {doc_items[0]['name']}?",
                    "Can you summarize the main themes across all documents?",
                    "What actionable takeaways are outlined in the files?",
                ]
                return {
                    "answer": greeting_answer,
                    "sources": [],
                    "source_files": [d["name"] for d in doc_items],
                    "citations": [],
                    "suggested_followups": sample_followups,
                    "model_used": "system",
                }
            else:
                return {
                    "answer": (
                        "Hello! I am your **DocQ&A Assistant**. You currently do not have any documents uploaded. "
                        "Please upload a PDF, Markdown, or text file via the sidebar to get started!"
                    ),
                    "sources": [],
                    "source_files": [],
                    "citations": [],
                    "suggested_followups": [],
                    "model_used": "system",
                }

        return {
            "answer": NO_ANSWER,
            "sources": [],
            "source_files": [],
            "citations": [],
            "suggested_followups": [],
            "model_used": "system",
        }

    context_blocks = []
    for i, c in enumerate(citations, 1):
        context_blocks.append(
            f"=== EXCERPT {i} [Source: {c['source']} | Passage #{c['chunk_index']} | Match: {c['relevance']}%] ===\n"
            f"{c['text']}"
        )
    context_string = "\n\n".join(context_blocks)

    mode_key = (request.mode or "detailed").lower()
    mode_instruction = MODE_INSTRUCTIONS.get(mode_key, MODE_INSTRUCTIONS["detailed"])

    prompt = PROMPT_TEMPLATE.format(
        context_string=context_string,
        query=query,
        mode_instruction=mode_instruction,
    )

    gemini_history = []
    recent_history = request.history[-MAX_HISTORY_ITEMS:]
    for msg in recent_history:
        role = "model" if msg.role == "assistant" else "user"
        gemini_history.append({"role": role, "parts": [msg.content[:16000]]})

    try:
        answer, model_used = generate_with_gemini(prompt, gemini_history)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Generation failed")
        raise to_http_error(exc, "Generation") from exc

    # Parse internal thinking / reasoning protocol if present
    thinking = None
    if "<thinking>" in answer and "</thinking>" in answer:
        parts = answer.split("</thinking>")
        thinking = parts[0].replace("<thinking>", "").strip()
        answer = parts[1].strip()
    elif "<think>" in answer and "</think>" in answer:
        parts = answer.split("</think>")
        thinking = parts[0].replace("<think>", "").strip()
        answer = parts[1].strip()

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
        "thinking": thinking,
        "sources": retrieved_chunks,
        "source_files": source_files,
        "citations": citations,
        "suggested_followups": suggested_followups,
        "model_used": model_used,
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
        summary_md, model_used = generate_with_gemini(summary_prompt, [])
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Summarization failed for %s", clean_name)
        raise to_http_error(exc, "Summarization") from exc

    if "</thinking>" in summary_md:
        summary_md = summary_md.split("</thinking>")[-1].strip()
    elif "</think>" in summary_md:
        summary_md = summary_md.split("</think>")[-1].strip()

    return {
        "filename": clean_name,
        "summary": summary_md,
        "total_chunks": len(docs),
        "model_used": model_used,
    }
