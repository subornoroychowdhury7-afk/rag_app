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

# Generation model
GENERATION_MODEL = (os.getenv("GENERATION_MODEL") or "gemini-3.5-flash-lite").strip()
GENERATION_TEMPERATURE = float((os.getenv("GENERATION_TEMPERATURE") or "0.2").strip())
# --------------------------------------------------------------------------- #
# HuggingFace Inference API Configuration (fallback chain)
# --------------------------------------------------------------------------- #
HF_API_TOKEN = (
    os.getenv("HF_API_TOKEN")
    or os.getenv("HF_API TOKEN")
    or os.getenv("HF_TOKEN")
    or os.getenv("HUGGINGFACE_API_KEY")
    or os.getenv("HUGGINGFACE_TOKEN")
    or os.getenv("HUGGING_FACE_HUB_TOKEN")
    or ""
).strip()
HF_API_OK = bool(HF_API_TOKEN) and not HF_API_TOKEN.startswith("your_")

# Ordered list of HuggingFace fallback models — tried in sequence when
# the primary Gemini model fails with a token/context/quota error.
# Override at runtime via the HF_MODELS env var (comma-separated model IDs).
_hf_models_env = (os.getenv("HF_MODELS") or "").strip()
HF_MODELS: list[str] = (
    [m.strip() for m in _hf_models_env.split(",") if m.strip()]
    if _hf_models_env
    else [
        # --- DeepSeek-R1 Series (State-of-the-Art Reasoning & Problem Solving) ---
        "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B",
        "deepseek-ai/DeepSeek-R1-Distill-Llama-8B",
        "deepseek-ai/DeepSeek-R1-Distill-Qwen-14B",
        "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",

        # --- Qwen 2.5 Flagships (Leading General, Math & Coding Intelligence) ---
        "Qwen/Qwen2.5-72B-Instruct",
        "Qwen/Qwen2.5-Coder-32B-Instruct",
        "Qwen/Qwen2.5-14B-Instruct",
        "Qwen/Qwen2.5-7B-Instruct",

        # --- Meta Llama 3 Series (Flagship 70B & 8B Performance) ---
        "meta-llama/Llama-3.3-70B-Instruct",
        "meta-llama/Meta-Llama-3.1-70B-Instruct",
        "meta-llama/Meta-Llama-3.1-8B-Instruct",

        # --- Mistral AI Series (European Flagship Reasoning & Dense MoE) ---
        "mistralai/Mistral-Small-24B-Instruct-2501",
        "mistralai/Mistral-7B-Instruct-v0.3",
        "mistralai/Mixtral-8x7B-Instruct-v0.1",

        # --- Google Gemma 2 (High Academic & Technical Accuracy) ---
        "google/gemma-2-27b-it",
        "google/gemma-2-9b-it",

        # --- Microsoft Phi Series (Compact High Reasoning) ---
        "microsoft/phi-4",
        "microsoft/Phi-3.5-mini-instruct",

        # --- Hugging Face Aligned Foundation ---
        "HuggingFaceH4/zephyr-7b-beta",
    ]
)

HF_API_BASE = "https://api-inference.huggingface.co/models"
HF_ROUTER_BASE = "https://router.huggingface.co/v1/chat/completions"
HF_MAX_NEW_TOKENS = int((os.getenv("HF_MAX_NEW_TOKENS") or "2048").strip())
HF_TIMEOUT = int((os.getenv("HF_TIMEOUT") or "40").strip())

if HF_API_OK:
    logger.info("HuggingFace fallback chain configured with %d models.", len(HF_MODELS))
else:
    logger.info("HF_API_TOKEN not set — HuggingFace fallback chain disabled.")


# Generation config: high token limit + low temperature for grounded, precise, high-accuracy answers
_generation_config = genai.types.GenerationConfig(
    max_output_tokens=8192,
    temperature=GENERATION_TEMPERATURE,
    top_p=0.95,
)
try:
    generation_model = genai.GenerativeModel(
        GENERATION_MODEL,
        generation_config=_generation_config,
    )
except Exception:
    generation_model = genai.GenerativeModel(GENERATION_MODEL)

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

PROMPT_TEMPLATE = """You are DocQ&A Assistant, an elite academic and technical research AI. \
Your objective is to deliver the most accurate, thorough, and insightful answer possible, \
grounded STRICTLY in the provided context excerpts from the user's uploaded documents.

CONTEXT EXCERPTS FROM UPLOADED DOCUMENTS:
{context_string}

USER QUESTION: {query}

{mode_instruction}

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
    content: str = Field(..., max_length=65536)


class ChatRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=MAX_QUERY_CHARS)
    history: list[Message] = Field(default_factory=list)
    doc_filter: Optional[str] = None
    mode: Optional[str] = Field(default="detailed", max_length=30)


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
    """Split text into semantically coherent overlapping windows."""
    if chunk_size <= 0:
        raise ValueError("chunk_size must be a positive integer")
    if overlap < 0 or overlap >= chunk_size:
        raise ValueError("overlap must be >= 0 and smaller than chunk_size")

    text = text.strip()
    if not text:
        return []
    if len(text) <= chunk_size:
        return [text]

    separators = ["\n\n", "\n", ". ", "? ", "! ", "; ", ", ", " ", ""]

    def _split(txt: str, sep_idx: int) -> list[str]:
        if len(txt) <= chunk_size:
            return [txt]
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


def contextualize_query(query: str, history: list[Message]) -> str:
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
    # Use fast Hugging Face model for query contextualization
    if HF_API_OK:
        for fast_m in ["Qwen/Qwen2.5-7B-Instruct", "mistralai/Mistral-7B-Instruct-v0.3", "HuggingFaceH4/zephyr-7b-beta"]:
            try:
                rewritten = call_huggingface_model(prompt, fast_m).strip().strip('"\'')
                if rewritten and len(rewritten) > 3 and not rewritten.lower().startswith("i cannot"):
                    logger.info("Contextualized query via HF (%s): '%s' -> '%s'", fast_m, query, rewritten)
                    return rewritten
            except Exception:
                continue

    # Fallback to Gemini if HF is not configured
    if API_KEY_OK:
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




# --------------------------------------------------------------------------- #
# HuggingFace Inference Helpers
# --------------------------------------------------------------------------- #


# --------------------------------------------------------------------------- #
# HuggingFace & Multi-Model Inference Helpers
# --------------------------------------------------------------------------- #

class _HFError(Exception):
    """Raised internally to signal a specific HuggingFace API failure mode."""
    def __init__(self, reason: str, message: str = ""):
        self.reason = reason   # "token_limit" | "rate_limit" | "loading" | "unavailable"
        self.message = message
        super().__init__(f"HF error [{reason}]: {message}")


def prepare_prompt_for_hf(prompt: str, max_chars: int = 9000) -> str:
    """Ensure prompt fits within Hugging Face free serverless context window limits."""
    if len(prompt) <= max_chars:
        return prompt
    if "USER QUESTION:" in prompt:
        parts = prompt.split("USER QUESTION:")
        context_part = parts[0]
        question_part = "USER QUESTION:" + parts[1]
        allowed_context = max(1000, max_chars - len(question_part) - 200)
        return context_part[:allowed_context] + "\n\n[...context summarized for model context window...]\n\n" + question_part
    return prompt[:max_chars]


def _call_hf_router(prompt: str, model_id: str) -> str:
    """Query Hugging Face's modern Inference Providers Router (OpenAI chat completions format)."""
    # Use :fastest provider alias if not already specified for instant provider selection
    router_model = model_id if ":" in model_id else f"{model_id}:fastest"
    payload = json.dumps({
        "model": router_model,
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "max_tokens": min(HF_MAX_NEW_TOKENS, 1500),
        "temperature": GENERATION_TEMPERATURE,
    }).encode("utf-8")
    req = urllib.request.Request(
        HF_ROUTER_BASE,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {HF_API_TOKEN}",
            "User-Agent": "DocQnA/1.0",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=HF_TIMEOUT) as resp:
        result = json.loads(resp.read())
        choices = result.get("choices") or []
        if choices and isinstance(choices[0], dict):
            msg = choices[0].get("message") or {}
            content = msg.get("content") or choices[0].get("text") or ""
            if content.strip():
                return content.strip()
    raise _HFError("unavailable", f"Empty content from HF router for {router_model}")


def _call_hf_legacy(prompt: str, model_id: str) -> str:
    """Query Hugging Face's classic serverless models endpoint."""
    clean_model_id = model_id.split(":")[0]
    url = f"{HF_API_BASE}/{clean_model_id}"
    payload = json.dumps({
        "inputs": prompt,
        "parameters": {
            "max_new_tokens": min(HF_MAX_NEW_TOKENS, 1024),
            "return_full_text": False,
        },
        "options": {
            "wait_for_model": True,
            "use_cache": True,
        },
    }).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {HF_API_TOKEN}",
            "User-Agent": "DocQnA/1.0",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=HF_TIMEOUT) as resp:
        result = json.loads(resp.read())

    text = ""
    if isinstance(result, list) and result:
        first = result[0]
        if isinstance(first, dict):
            text = first.get("generated_text") or first.get("translation_text") or ""
        else:
            text = str(first)
    elif isinstance(result, dict):
        text = result.get("generated_text") or result.get("translation_text") or ""
        if not text and "error" in result:
            raise _HFError("unavailable", str(result["error"]))
    else:
        text = str(result)
    return text.strip()


def call_huggingface_model(prompt: str, model_id: str) -> str:
    """POST to Hugging Face via the modern Router first, with automatic fallback to classic legacy endpoint."""
    trimmed_prompt = prepare_prompt_for_hf(prompt, max_chars=8000)

    # 1. Try modern Inference Providers Router (best for DeepSeek-R1, Qwen2.5-72B)
    try:
        raw_text = _call_hf_router(trimmed_prompt, model_id)
        if raw_text and len(raw_text.strip()) > 0:
            return _format_model_response(raw_text)
    except Exception as router_err:
        logger.debug("HF router call for %s skipped (%s) — falling back to classic serverless.", model_id, router_err)

    # 2. Fallback: classic serverless endpoint (runs free-tier 7B/8B models reliably)
    try:
        raw_text = _call_hf_legacy(trimmed_prompt, model_id)
        if raw_text and len(raw_text.strip()) > 0:
            return _format_model_response(raw_text)
    except urllib.error.HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        b_lower = body.lower()
        if exc.code == 429:
            raise _HFError("rate_limit", f"HTTP 429 from {model_id}") from exc
        if exc.code == 503:
            raise _HFError("loading", f"{model_id} cold starting") from exc
        if exc.code == 413 or "too many tokens" in b_lower:
            raise _HFError("token_limit", f"Token limit on {model_id}") from exc
        raise _HFError("unavailable", f"HTTP {exc.code} from {model_id}: {body[:100]}") from exc
    except Exception as exc:
        raise _HFError("unavailable", f"Network error calling {model_id}: {exc}") from exc

    raise _HFError("unavailable", f"Empty response from {model_id}")


def _format_model_response(text: str) -> str:
    """Format model output (clean DeepSeek-R1 <think> tags into styled markdown)."""
    text = text.strip()
    if "<think>" in text and "</think>" in text:
        text = re.sub(
            r"<think>\s*(.*?)\s*</think>",
            r"> 🧠 **Reasoning:**\n> \1\n\n",
            text,
            flags=re.DOTALL,
        )
    return text.strip()


def select_models_for_workflow(query: str = "", mode: str = "detailed") -> list[str]:
    """Dynamically prioritize frontier Hugging Face models tailored to the user's workflow.

    Includes both elite 32B/70B reasoning models and instant free-tier 7B/8B models so that
    it succeeds immediately whether the user has Inference Provider credits or free serverless.
    """
    q_lower = query.lower()
    m_lower = (mode or "detailed").lower()

    math_indicators = {
        "formula", "equation", "calculate", "theorem", "math", "proof", "solve",
        "derivative", "integral", "probability", "statistics", "matrix", "algebra",
        "calculus", "latex", "variance", "deviation", "complexity", "ratio",
    }
    code_indicators = {
        "code", "python", "function", "api", "algorithm", "class", "sql", "typescript",
        "javascript", "debug", "error", "terminal", "script", "json", "endpoint",
        "react", "docker", "pipeline", "syntax", "git", "database", "method", "loop",
    }

    words = set(re.findall(r"\b\w+\b", q_lower))
    is_math = bool(words & math_indicators)
    is_code = bool(words & code_indicators)

    preferred: list[str] = []

    if is_code or m_lower == "step_by_step":
        preferred = [
            "Qwen/Qwen2.5-Coder-32B-Instruct",
            "Qwen/Qwen2.5-7B-Instruct",
            "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
            "microsoft/Phi-3.5-mini-instruct",
            "mistralai/Mistral-7B-Instruct-v0.3",
            "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B",
            "microsoft/phi-4",
            "Qwen/Qwen2.5-72B-Instruct",
        ]
    elif is_math or m_lower == "academic":
        preferred = [
            "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
            "deepseek-ai/DeepSeek-R1-Distill-Llama-8B",
            "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B",
            "Qwen/Qwen2.5-7B-Instruct",
            "Qwen/Qwen2.5-72B-Instruct",
            "google/gemma-2-9b-it",
            "google/gemma-2-27b-it",
        ]
    elif m_lower == "concise":
        preferred = [
            "mistralai/Mistral-7B-Instruct-v0.3",
            "google/gemma-2-9b-it",
            "Qwen/Qwen2.5-7B-Instruct",
            "meta-llama/Meta-Llama-3.1-8B-Instruct",
            "mistralai/Mistral-Small-24B-Instruct-2501",
            "HuggingFaceH4/zephyr-7b-beta",
        ]
    else:  # detailed (default)
        preferred = [
            "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
            "Qwen/Qwen2.5-7B-Instruct",
            "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B",
            "mistralai/Mistral-7B-Instruct-v0.3",
            "Qwen/Qwen2.5-72B-Instruct",
            "google/gemma-2-9b-it",
            "HuggingFaceH4/zephyr-7b-beta",
            "meta-llama/Meta-Llama-3.1-8B-Instruct",
        ]

    seen = set()
    result = []
    for model in preferred:
        if model in HF_MODELS and model not in seen:
            seen.add(model)
            result.append(model)

    for model in HF_MODELS:
        if model not in seen:
            seen.add(model)
            result.append(model)

    return result


def generate_with_gemini(prompt: str, gemini_history: list[dict]) -> tuple[str, str]:
    """Call Google Gemini with automatic fallback across known valid Gemini 3 and 2 models."""
    configured_model = GENERATION_MODEL.strip()

    # If the user or environment has a deprecated model name like gemini-2.5-pro, normalize it
    if "2.5-pro" in configured_model or not configured_model:
        configured_model = "gemini-3.5-flash-lite"

    # Try Gemini 3 generation models first as requested, followed by stable fallbacks
    candidates = [
        configured_model,
        "gemini-3.5-flash-lite",
        "gemini-3.8-flash",
        "gemini-3.5-flash",
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
            logger.warning("Gemini model '%s' failed (%s) — trying next model in chain...", m_name, exc)
            last_exc = exc
            continue

    if last_exc:
        raise to_http_error(last_exc, "Generation") from last_exc
    raise HTTPException(502, "All Gemini generation models failed.")


def generate_with_fallback(
    prompt: str,
    gemini_history: list[dict],
    query: str = "",
    mode: str = "detailed",
) -> tuple[str, str]:
    """Generate an answer using workflow-tailored frontier Hugging Face models as primary,
    rotating instantly through warm models on token/rate limits, with Gemini as safety backup.

    Returns:
        tuple[str, str]: (generated_answer, model_name_used)
    """
    # ── 1. Primary: Hugging Face Frontier Models Tailored to Workflow ─────────
    if HF_API_OK:
        model_candidates = select_models_for_workflow(query=query, mode=mode)
        for model_id in model_candidates[:8]:
            try:
                answer = call_huggingface_model(prompt, model_id)
                logger.info("Successfully generated answer using %s", model_id)
                return answer, model_id
            except _HFError as hf_err:
                logger.warning("HF model %s failed (%s) — rotating to next candidate.", model_id, hf_err.reason)
                continue
            except Exception as exc:
                logger.warning("HF model %s unexpected error (%s) — rotating to next candidate.", model_id, exc)
                continue

        logger.warning("Hugging Face models unavailable or busy. Engaging Gemini safety net.")

    # ── 2. Fallback: Gemini Safety Net with Auto-Model Fallback ──────────────
    if not API_KEY_OK:
        raise HTTPException(
            503,
            "Hugging Face models are currently busy, and GEMINI_API_KEY is not configured.",
        )

    return generate_with_gemini(prompt, gemini_history)


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
                clean_page = re.sub(r'(\w+)-\n(\w+)', r'\1\2', page_text)
                text_pages.append(f"[Page {page_number}]\n{clean_page}")
                continue

            # Render at 200 DPI for optimal balance of OCR accuracy and performance
            pixmap = page.get_pixmap(matrix=fitz.Matrix(200 / 72, 200 / 72), alpha=False)
            image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
            page_text = pytesseract.image_to_string(image).strip()
            if page_text:
                clean_ocr = re.sub(r'(\w+)-\n(\w+)', r'\1\2', page_text)
                text_pages.append(f"[Page {page_number}]\n{clean_ocr}")
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

@app.get("/debug-hf")
def debug_hf(model: str = "Qwen/Qwen2.5-7B-Instruct"):
    """Diagnostic endpoint to inspect live Hugging Face API responses and latency."""
    started = time.perf_counter()
    router_err = None
    legacy_err = None
    prompt = "Hello! Please answer in 1 sentence: what is 2 + 2?"

    router_res = None
    try:
        router_res = _call_hf_router(prompt, model)
    except Exception as e:
        router_err = f"{type(e).__name__}: {e}"

    legacy_res = None
    try:
        legacy_res = _call_hf_legacy(prompt, model)
    except Exception as e:
        legacy_err = f"{type(e).__name__}: {e}"

    elapsed = round(time.perf_counter() - started, 2)
    return {
        "model": model,
        "elapsed_seconds": elapsed,
        "hf_configured": HF_API_OK,
        "hf_token_prefix": HF_API_TOKEN[:6] + "..." if HF_API_TOKEN else "none",
        "router_result": router_res,
        "router_error": router_err,
        "legacy_result": legacy_res,
        "legacy_error": legacy_err,
    }


@app.get("/health")
def health():
    return {
        "status": "ok",
        "gemini_configured": API_KEY_OK,
        "hf_configured": HF_API_OK,
        "hf_models_count": len(HF_MODELS),
    }


@app.post("/upload")
def upload(file: UploadFile = File(...)):
    # Validate file format and content BEFORE checking API key so that
    # bad-request errors are always returned as 400, even in environments
    # where GEMINI_API_KEY is not configured.
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
            }
        return {
            "answer": NO_ANSWER,
            "sources": [],
            "source_files": [],
            "citations": [],
            "suggested_followups": [],
        }

    # Contextualize follow-up questions using recent chat turns for accurate retrieval
    search_query = contextualize_query(query, request.history)

    try:
        query_vector = embed_text(search_query, "retrieval_query")
    except Exception as exc:
        logger.exception("Query embedding failed")
        raise to_http_error(exc, "Embedding") from exc

    # Retrieve candidate pool for hybrid vector + keyword re-ranking
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

        # Hybrid composite score combining dense semantic and exact lexical signals
        if kw_sim > 0:
            composite_score = 0.65 * vec_sim + 0.35 * kw_sim
        else:
            composite_score = 0.85 * vec_sim

        # Dynamically widen cutoff for passages with strong keyword overlap
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

    # Re-rank by composite score descending
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
        }

    # Format structured context blocks with source, section, and match metadata
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

    # Limit history to prevent excessive context blowup
    gemini_history = []
    recent_history = request.history[-MAX_HISTORY_ITEMS:]
    for msg in recent_history:
        role = "model" if msg.role == "assistant" else "user"
        gemini_history.append({"role": role, "parts": [msg.content[:16000]]})

    try:
        answer, model_used = generate_with_fallback(prompt, gemini_history, query=query, mode=mode_key)
    except HTTPException:
        raise
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
        summary_md, model_used = generate_with_fallback(
            summary_prompt,
            gemini_history=[],
            query=clean_name,
            mode="detailed",
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Summarization failed for %s", clean_name)
        raise to_http_error(exc, "Summarization") from exc

    return {
        "filename": clean_name,
        "summary": summary_md,
        "total_chunks": len(docs),
        "model_used": model_used,
    }
