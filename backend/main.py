"""RAG backend.

POST /upload : PDF -> text -> overlapping chunks -> Gemini embeddings -> ChromaDB
POST /chat   : question -> embedding -> top-K similar chunks -> Gemini answer
"""

import base64
import hashlib
import hmac
import json
import logging
import math
import os
import re
import secrets
import sqlite3
import time
import urllib.error
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from typing import Literal

import chromadb
import fitz
import google.generativeai as genai
import pytesseract
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from google.api_core import exceptions as gexc
from pydantic import BaseModel, Field

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
load_dotenv()

logger = logging.getLogger("rag")
logging.basicConfig(level=logging.INFO)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
API_KEY_OK = bool(GEMINI_API_KEY) and not GEMINI_API_KEY.startswith("your_")
if not API_KEY_OK:
    logger.warning("GEMINI_API_KEY is not set - /upload and /chat will fail until it is.")

genai.configure(api_key=GEMINI_API_KEY)

# "models/text-embedding-004" was shut down on 2026-01-14. The same model + dimension
# must be used for ingestion and for query embedding, otherwise search breaks.
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "models/gemini-embedding-2")
EMBEDDING_DIM = int(os.getenv("EMBEDDING_DIM", "768"))

# Gemini 2.5 models are scheduled to shut down in October 2026 - override in .env.
GENERATION_MODEL = os.getenv("GENERATION_MODEL", "gemini-2.5-flash")
generation_model = genai.GenerativeModel(GENERATION_MODEL)

CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "1800"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "180"))
TOP_K = 5

# Cosine DISTANCE cutoff (0 = identical, ~1 = unrelated). Chunks further away than
# this are treated as irrelevant; if none qualify, /chat refuses without calling the
# LLM. Distances are logged on every /chat call - tune this if it is too strict/loose.
MAX_DISTANCE = float(os.getenv("MAX_DISTANCE", "0.65"))

MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "20"))
MAX_QUERY_CHARS = 2000
MAX_RETRIES = 4  # attempts per Gemini call on rate-limit / transient errors
AUTH_DB_PATH = Path(os.getenv("AUTH_DB_PATH", "./auth.sqlite3"))
AUTH_SECRET = os.getenv("AUTH_SECRET", "")
TOKEN_TTL_SECONDS = 12 * 60 * 60
CHAT_LIMIT_PER_HOUR = int(os.getenv("CHAT_LIMIT_PER_HOUR", "30"))
UPLOAD_LIMIT_PER_DAY = int(os.getenv("UPLOAD_LIMIT_PER_DAY", "10"))
AUTH_LIMIT_PER_15_MINUTES = int(os.getenv("AUTH_LIMIT_PER_15_MINUTES", "100"))
LOGIN_EMAIL_LIMIT_PER_15_MINUTES = int(os.getenv("LOGIN_EMAIL_LIMIT_PER_15_MINUTES", "10"))

if not AUTH_SECRET:
    logger.error("AUTH_SECRET is not set - authentication endpoints will be unavailable.")


def open_auth_db() -> sqlite3.Connection:
    AUTH_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(AUTH_DB_PATH, timeout=15)
    connection.row_factory = sqlite3.Row
    return connection


@contextmanager
def auth_db():
    connection = open_auth_db()
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def initialize_auth_db() -> None:
    with auth_db() as connection:
        connection.execute(
            """CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                password_salt TEXT NOT NULL,
                created_at REAL NOT NULL
            )"""
        )
        connection.execute(
            """CREATE TABLE IF NOT EXISTS rate_limit_buckets (
                subject TEXT NOT NULL,
                action TEXT NOT NULL,
                tokens REAL NOT NULL,
                updated_at REAL NOT NULL,
                PRIMARY KEY (subject, action)
            )"""
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS rate_limit_buckets_updated_at "
            "ON rate_limit_buckets (updated_at)"
        )


initialize_auth_db()

NO_ANSWER = "I cannot answer this based on the uploaded documents."

PROMPT_TEMPLATE = """You are a helpful and precise assistant. Answer the user's question using ONLY the provided context.
If the answer is not in the context, say 'I cannot answer this based on the uploaded documents.'
Do not use outside knowledge.

Context:
{context_string}

User Question: {query}
"""

# Vector store. With CHROMA_API_KEY set (+ CHROMA_TENANT / CHROMA_DATABASE) the data lives
# in Chroma Cloud, so the web server itself can be stateless and free-tier friendly.
# Otherwise it falls back to a local on-disk store (set CHROMA_PATH to a mounted disk).
CHROMA_API_KEY = os.getenv("CHROMA_API_KEY")
if CHROMA_API_KEY:
    chroma_client = chromadb.CloudClient(
        tenant=os.getenv("CHROMA_TENANT"),
        database=os.getenv("CHROMA_DATABASE"),
        api_key=CHROMA_API_KEY,
    )
    index_config = {"spann": {"space": "cosine"}}  # Chroma Cloud's index type
    logger.info("Using Chroma Cloud")
else:
    chroma_client = chromadb.PersistentClient(path=os.getenv("CHROMA_PATH", "./chroma_db"))
    index_config = {"hnsw": {"space": "cosine"}}  # local index type
    logger.info("Using local ChromaDB")

try:
    collection = chroma_client.get_or_create_collection(name="rag_collection", configuration=index_config)
except Exception:  # e.g. the service rejects the index config - fall back to its defaults
    logger.warning("Could not apply cosine index config; using ChromaDB defaults "
                   "(retune MAX_DISTANCE using the logged distances).", exc_info=True)
    collection = chroma_client.get_or_create_collection(name="rag_collection")

app = FastAPI(title="RAG Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type"],
)


class Credentials(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=12, max_length=128)


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4_000)


class ChatRequest(BaseModel):
    query: str
    history: list[Message] = Field(default_factory=list, max_length=20)


def ensure_auth_configured() -> None:
    if len(AUTH_SECRET) < 32:
        raise HTTPException(
            503,
            "Authentication is unavailable: configure a random AUTH_SECRET of at least 32 characters.",
        )


def normalize_email(email: str) -> str:
    normalized = email.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", normalized):
        raise HTTPException(422, "Enter a valid email address.")
    return normalized


def hash_password(password: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 600_000)


def encode_token(user_id: str) -> str:
    ensure_auth_configured()
    header = base64.urlsafe_b64encode(b'{"alg":"HS256","typ":"JWT"}').rstrip(b"=")
    payload = base64.urlsafe_b64encode(
        json.dumps({"sub": user_id, "exp": int(time.time()) + TOKEN_TTL_SECONDS}, separators=(",", ":")).encode()
    ).rstrip(b"=")
    signing_input = header + b"." + payload
    signature = hmac.new(AUTH_SECRET.encode(), signing_input, hashlib.sha256).digest()
    return (signing_input + b"." + base64.urlsafe_b64encode(signature).rstrip(b"=")).decode("ascii")


def decode_token(token: str) -> str:
    ensure_auth_configured()
    try:
        encoded_header, encoded_payload, encoded_signature = token.split(".")
        signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")
        signature = base64.urlsafe_b64decode(encoded_signature + "=" * (-len(encoded_signature) % 4))
        expected_signature = hmac.new(AUTH_SECRET.encode(), signing_input, hashlib.sha256).digest()
        if not hmac.compare_digest(signature, expected_signature):
            raise ValueError("Invalid signature")
        header = json.loads(base64.urlsafe_b64decode(encoded_header + "=" * (-len(encoded_header) % 4)))
        payload = json.loads(base64.urlsafe_b64decode(encoded_payload + "=" * (-len(encoded_payload) % 4)))
        user_id = payload["sub"]
        if header.get("alg") != "HS256" or not isinstance(user_id, str) or payload["exp"] <= time.time():
            raise ValueError("Invalid or expired token")
        return user_id
    except (ValueError, KeyError, TypeError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(
            401,
            "Invalid or expired access token.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


def get_current_user(authorization: str | None = Header(default=None)) -> dict[str, str]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Authentication required.", headers={"WWW-Authenticate": "Bearer"})
    user_id = decode_token(authorization[7:].strip())
    with auth_db() as connection:
        user = connection.execute("SELECT id, email FROM users WHERE id = ?", (user_id,)).fetchone()
    if user is None:
        raise HTTPException(401, "Invalid or expired access token.", headers={"WWW-Authenticate": "Bearer"})
    return {"id": user["id"], "email": user["email"]}


def enforce_rate_limit(subject: str, action: str, limit: int, window_seconds: int) -> None:
    now = time.time()
    if limit < 1 or window_seconds < 1:
        raise HTTPException(503, "Rate limits are misconfigured on the server.")
    with auth_db() as connection:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute("DELETE FROM rate_limit_buckets WHERE updated_at < ?", (now - 86_400,))
        bucket = connection.execute(
            "SELECT tokens, updated_at FROM rate_limit_buckets WHERE subject = ? AND action = ?",
            (subject, action),
        ).fetchone()
        tokens = float(limit) if bucket is None else min(
            float(limit),
            bucket["tokens"] + max(0.0, now - bucket["updated_at"]) * limit / window_seconds,
        )
        allowed = tokens >= 1.0
        remaining = tokens - 1.0 if allowed else tokens
        connection.execute(
            """INSERT INTO rate_limit_buckets (subject, action, tokens, updated_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT (subject, action)
               DO UPDATE SET tokens = excluded.tokens, updated_at = excluded.updated_at""",
            (subject, action, remaining, now),
        )
        connection.commit()
        if allowed:
            return

    retry_after = math.ceil((1.0 - tokens) * window_seconds / limit)
    logger.warning(
        "Rate limit exceeded: action=%s subject=%s limit=%d retry_after=%d",
        action,
        subject,
        limit,
        retry_after,
    )
    raise HTTPException(
        429,
        "Too many requests. Please wait before trying again.",
        headers={"Retry-After": str(max(1, retry_after))},
    )


def hash_rate_limit_subject(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 200) -> list[str]:
    """Split ``text`` into overlapping windows of at most ``chunk_size`` characters.

    Empty/whitespace text -> []; text shorter than chunk_size -> one chunk;
    overlap >= chunk_size -> ValueError (the window would never advance).
    """
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
    gexc.ResourceExhausted,    # 429 rate limit / quota
    gexc.ServiceUnavailable,   # 503
    gexc.DeadlineExceeded,     # 504
    gexc.InternalServerError,  # 500
)


def call_gemini(fn, *args, **kwargs):
    """Call a Gemini SDK function, retrying rate-limit/transient errors with
    exponential backoff (1s, 2s, 4s). Other errors propagate immediately."""
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
    """Translate a Gemini/SDK failure into a clear, user-facing HTTP error."""
    if isinstance(exc, gexc.ResourceExhausted):
        return HTTPException(429, "The Gemini API rate limit or quota was reached. "
                                  "Please wait a minute and try again.")
    if isinstance(exc, (gexc.Unauthenticated, gexc.PermissionDenied)) or (
        isinstance(exc, gexc.InvalidArgument) and "API key" in str(exc)
    ):
        return HTTPException(500, "The Gemini API key is missing, invalid, or not permitted. "
                                  "Check GEMINI_API_KEY in backend/.env.")
    if isinstance(exc, gexc.NotFound):
        return HTTPException(502, f"Gemini model not found. Check EMBEDDING_MODEL / "
                                  f"GENERATION_MODEL in backend/.env. ({exc})")
    if isinstance(exc, (gexc.ServiceUnavailable, gexc.DeadlineExceeded, gexc.InternalServerError)):
        return HTTPException(503, "The Gemini API is temporarily unavailable. Please try again shortly.")
    return HTTPException(502, f"{action} failed: {exc}")


def require_api_key() -> None:
    if not API_KEY_OK:
        raise HTTPException(500, "GEMINI_API_KEY is not configured on the server (backend/.env).")


def embed_text(text: str, task_type: str = "retrieval_document") -> list[float]:
    """Embed ``text``. Use "retrieval_document" when ingesting and "retrieval_query"
    for user questions - the model embeds the two differently on purpose."""
    result = call_gemini(
        genai.embed_content,
        model=EMBEDDING_MODEL,
        content=text,
        task_type=task_type,
        output_dimensionality=EMBEDDING_DIM,
    )
    return result["embedding"]


def embed_texts(texts: list[str], task_type: str = "retrieval_document") -> list[list[float]]:
    """Embed in bounded batches, running two batches in parallel for large PDFs."""
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
            raise HTTPException(429, "The Gemini API rate limit or quota was reached during OCR. Please wait and try again.") from exc
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
    """Extract embedded text and OCR only pages that contain no selectable text."""
    text_pages: list[str] = []
    try:
        document = fitz.open(stream=contents, filetype="pdf")
        if document.needs_pass:
            raise HTTPException(400, "Encrypted PDFs are not supported.")
        for page_number, page in enumerate(document, start=1):
            page_text = page.get_text("text").strip()
            if page_text:
                text_pages.append(page_text)
                continue

            # Render at 200 DPI for a useful balance of OCR accuracy and speed.
            pixmap = page.get_pixmap(matrix=fitz.Matrix(200 / 72, 200 / 72), alpha=False)
            from PIL import Image

            image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
            page_text = pytesseract.image_to_string(image).strip()
            text_pages.append(page_text)
            logger.info("OCR page %d/%d: %d characters", page_number, len(document), len(page_text))
        document.close()
    except HTTPException:
        raise
    except (fitz.FileDataError, fitz.EmptyFileError) as exc:
        raise HTTPException(400, f"Could not read PDF: {exc}") from exc
    except pytesseract.TesseractNotFoundError:
        document.close()
        logger.warning("Tesseract is unavailable; falling back to Gemini PDF transcription")
        return ocr_pdf_with_gemini(contents)
    except Exception as exc:
        logger.exception("PDF text extraction or OCR failed")
        raise HTTPException(422, f"Could not extract text from PDF: {exc}") from exc
    return "\n".join(text_pages)


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #
@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/auth/register")
def register(credentials: Credentials, request: Request):
    ensure_auth_configured()
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit(hash_rate_limit_subject(client_ip), "register", AUTH_LIMIT_PER_15_MINUTES, 900)
    email = normalize_email(credentials.email)
    salt = secrets.token_bytes(16)
    user_id = str(uuid.uuid4())
    password_hash = hash_password(credentials.password, salt)
    try:
        with auth_db() as connection:
            connection.execute(
                "INSERT INTO users (id, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)",
                (user_id, email, password_hash.hex(), salt.hex(), time.time()),
            )
    except sqlite3.IntegrityError as exc:
        logger.info("Registration rejected: email already registered")
        raise HTTPException(409, "An account with this email already exists.") from exc
    logger.info("Account created: user_id=%s", user_id)
    return {
        "access_token": encode_token(user_id),
        "token_type": "bearer",
        "expires_in": TOKEN_TTL_SECONDS,
        "user": {"email": email},
    }


@app.post("/auth/login")
def login(credentials: Credentials, request: Request):
    ensure_auth_configured()
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit(hash_rate_limit_subject(client_ip), "login", AUTH_LIMIT_PER_15_MINUTES, 900)
    email = normalize_email(credentials.email)
    enforce_rate_limit(
        hash_rate_limit_subject(email),
        "login_account",
        LOGIN_EMAIL_LIMIT_PER_15_MINUTES,
        900,
    )
    with auth_db() as connection:
        user = connection.execute(
            "SELECT id, password_hash, password_salt FROM users WHERE email = ?", (email,)
        ).fetchone()
    if user is None or not hmac.compare_digest(
        hash_password(credentials.password, bytes.fromhex(user["password_salt"])).hex(),
        user["password_hash"],
    ):
        logger.warning("Login failed: invalid credentials")
        raise HTTPException(401, "Email or password is incorrect.")
    logger.info("Account authenticated: user_id=%s", user["id"])
    return {
        "access_token": encode_token(user["id"]),
        "token_type": "bearer",
        "expires_in": TOKEN_TTL_SECONDS,
        "user": {"email": email},
    }


@app.post("/upload")
def upload(file: UploadFile = File(...), user: dict[str, str] = Depends(get_current_user)):
    # Plain `def`: pypdf and the Gemini SDK are blocking, so FastAPI runs this in
    # its threadpool instead of stalling the event loop.
    enforce_rate_limit(user["id"], "upload", UPLOAD_LIMIT_PER_DAY, 86_400)
    require_api_key()

    # 1. Validate
    filename = file.filename or ""
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are supported.")

    max_bytes = MAX_UPLOAD_MB * 1024 * 1024
    contents = file.file.read(max_bytes + 1)
    if len(contents) > max_bytes:
        raise HTTPException(413, f"File is too large (limit is {MAX_UPLOAD_MB} MB).")
    if not contents:
        raise HTTPException(400, "The uploaded file is empty.")

    # 2. Extract selectable text and OCR scanned pages (in memory - no PDF is saved).
    started_at = time.perf_counter()
    text = extract_pdf_text(contents)
    extracted_at = time.perf_counter()

    # 3. Chunk
    chunks = chunk_text(text, chunk_size=CHUNK_SIZE, overlap=CHUNK_OVERLAP)
    if not chunks:
        raise HTTPException(422, "No extractable text found (scanned/image-only PDFs need OCR).")

    # 4. Embed every chunk BEFORE touching the database, so an API failure part-way
    #    can't leave a half-ingested document (or destroy the previous version).
    try:
        embeddings = embed_texts(chunks, "retrieval_document")
    except Exception as exc:
        logger.exception("Embedding failed for %s", filename)
        raise to_http_error(exc, "Embedding") from exc
    embedded_at = time.perf_counter()

    # 5. Re-uploading a file replaces its earlier chunks instead of duplicating them
    owner_filter = {"$and": [{"owner_id": user["id"]}, {"source": filename}]}
    previous = collection.get(where=owner_filter, include=[])["ids"]
    if previous:
        collection.delete(ids=previous)

    collection.add(
        ids=[str(uuid.uuid4()) for _ in chunks],
        embeddings=embeddings,
        documents=chunks,
        metadatas=[
            {"owner_id": user["id"], "source": filename, "chunk_index": i}
            for i in range(len(chunks))
        ],
    )

    completed_at = time.perf_counter()
    logger.info(
        "Ingested source=%s user_id=%s chunks=%d replaced=%d; extraction %.2fs, embedding %.2fs, storage %.2fs, total %.2fs",
        filename, user["id"], len(chunks), len(previous), extracted_at - started_at,
        embedded_at - extracted_at, completed_at - embedded_at, completed_at - started_at,
    )
    return {"message": "Upload successful", "filename": filename, "chunks_processed": len(chunks)}


@app.get("/documents")
def get_documents(user: dict[str, str] = Depends(get_current_user)):
    """List the authenticated user's documents and their chunk counts."""
    results = collection.get(where={"owner_id": user["id"]}, include=["metadatas"])
    metadatas = results["metadatas"] or []
    docs = {}
    for meta in metadatas:
        source = meta.get("source", "unknown")
        docs[source] = docs.get(source, 0) + 1
    return [{"name": name, "chunks": count} for name, count in docs.items()]


@app.delete("/documents/{filename:path}")
def delete_document(filename: str, user: dict[str, str] = Depends(get_current_user)):
    """Remove the authenticated user's chunks associated with `filename`."""
    results = collection.get(
        where={"$and": [{"owner_id": user["id"]}, {"source": filename}]},
        include=[],
    )
    if not results["ids"]:
        raise HTTPException(404, f"No document found with name '{filename}'.")
    collection.delete(ids=results["ids"])
    logger.info("Deleted %d chunks for user_id=%s source=%s",
                len(results["ids"]), user["id"], filename)
    return {"message": "Document deleted", "filename": filename, "chunks_deleted": len(results["ids"])}


@app.post("/chat")
def chat(chat_request: ChatRequest, user: dict[str, str] = Depends(get_current_user)):
    enforce_rate_limit(user["id"], "chat", CHAT_LIMIT_PER_HOUR, 3_600)
    query = chat_request.query.strip()
    if not query:
        raise HTTPException(400, "Query must not be empty.")
    if len(query) > MAX_QUERY_CHARS:
        raise HTTPException(400, f"Query is too long (limit is {MAX_QUERY_CHARS} characters).")
    require_api_key()
    logger.info("Chat request: user_id=%s query_chars=%d", user["id"], len(query))

    # Nothing ingested yet -> no context, so don't spend an API call.
    owner_filter = {"owner_id": user["id"]}
    owned_chunks = collection.get(where=owner_filter, limit=1, include=[])["ids"]
    if not owned_chunks:
        return {"answer": NO_ANSWER, "sources": []}

    # 1. Embed the query (same model + dimension as the stored chunks)
    try:
        query_vector = embed_text(query, "retrieval_query")
    except Exception as exc:
        logger.exception("Query embedding failed")
        raise to_http_error(exc, "Embedding") from exc

    # 2. Vector search, then keep only chunks that are actually relevant
    results = collection.query(
        query_embeddings=[query_vector],
        n_results=TOP_K,
        include=["documents", "distances"],
        where=owner_filter,
    )
    distances: list[float] = results["distances"][0]
    logger.info("Retrieval distances (cutoff %.2f): %s", MAX_DISTANCE, [round(d, 3) for d in distances])
    retrieved_chunks = [
        doc for doc, dist in zip(results["documents"][0], distances) if dist <= MAX_DISTANCE
    ]

    # Nothing relevant -> refuse deterministically; the LLM never gets a chance to guess.
    if not retrieved_chunks:
        return {"answer": NO_ANSWER, "sources": []}

    # 3. Build the strict prompt around the retrieved context
    context_string = "\n".join(retrieved_chunks)
    prompt = PROMPT_TEMPLATE.format(context_string=context_string, query=query)

    # 4. Generate
    gemini_history = []
    for msg in chat_request.history:
        # map "assistant" to "model" for Gemini
        role = "model" if msg.role == "assistant" else "user"
        gemini_history.append({"role": role, "parts": [msg.content]})

    try:
        chat_session = generation_model.start_chat(history=gemini_history)
        response = call_gemini(chat_session.send_message, prompt)
        answer = response.text  # raises ValueError if the response was blocked/empty
    except ValueError as exc:
        logger.warning("Response blocked or empty: %s", exc)
        raise HTTPException(502, "The model returned no answer (the response was blocked or empty). "
                                 "Try rephrasing your question.") from exc
    except Exception as exc:
        logger.exception("Generation failed")
        raise to_http_error(exc, "Generation") from exc

    return {"answer": answer, "sources": retrieved_chunks}
