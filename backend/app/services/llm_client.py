"""Google Gemini LLM & embedding client with retry backoff and model fallback."""

from concurrent.futures import ThreadPoolExecutor
import logging
import time

from fastapi import HTTPException
from google.api_core import exceptions as gexc
import google.generativeai as genai

from app.config import Settings

logger = logging.getLogger("rag.llm")

RETRYABLE_EXCEPTIONS = (
    gexc.ResourceExhausted,
    gexc.ServiceUnavailable,
    gexc.DeadlineExceeded,
    gexc.InternalServerError,
)


def to_http_error(exc: Exception, action: str) -> HTTPException:
    """Translate a Gemini SDK failure into a structured HTTP exception."""
    if isinstance(exc, gexc.ResourceExhausted):
        return HTTPException(
            429, "The Gemini API rate limit or quota was reached. Please wait a moment and try again."
        )
    if isinstance(exc, (gexc.Unauthenticated, gexc.PermissionDenied)) or (
        isinstance(exc, gexc.InvalidArgument) and "API key" in str(exc)
    ):
        return HTTPException(
            500, "The Gemini API key is missing or invalid. Check GEMINI_API_KEY in environment variables."
        )
    if isinstance(exc, gexc.NotFound):
        return HTTPException(
            502, f"Gemini model not found. Check EMBEDDING_MODEL / GENERATION_MODEL. ({exc})"
        )
    if isinstance(exc, (gexc.ServiceUnavailable, gexc.DeadlineExceeded, gexc.InternalServerError)):
        return HTTPException(503, "The Gemini API is temporarily unavailable. Please try again shortly.")
    return HTTPException(502, f"{action} failed: {exc}")


class GeminiClient:
    """Encapsulates Gemini generation and embedding operations."""

    def __init__(self, settings: Settings):
        self.settings = settings
        genai.configure(api_key=settings.gemini_api_key)
        self._generation_config = genai.types.GenerationConfig(
            max_output_tokens=8192,
            temperature=settings.generation_temperature,
            top_p=0.95,
        )

    def require_api_key(self) -> None:
        if not self.settings.api_key_configured:
            raise HTTPException(500, "GEMINI_API_KEY is not configured on the server.")

    def call_with_retry(self, fn, *args, **kwargs):
        """Invoke a Gemini SDK function with exponential backoff on transient failures."""
        delay = 1.0
        for attempt in range(1, self.settings.max_retries + 1):
            try:
                return fn(*args, **kwargs)
            except RETRYABLE_EXCEPTIONS as exc:
                if attempt == self.settings.max_retries:
                    raise
                logger.warning(
                    "Gemini %s (attempt %d/%d) - retrying in %.0fs",
                    type(exc).__name__,
                    attempt,
                    self.settings.max_retries,
                    delay,
                )
                time.sleep(delay)
                delay *= 2

    def generate(self, prompt: str, gemini_history: list[dict]) -> tuple[str, str]:
        """Generate a completion using configured model with fallback across Flash variants."""
        configured = self.settings.generation_model.strip() or "gemini-3.8-flash"
        candidates = [
            configured,
            "gemini-3.8-flash",
            "gemini-3.8-flash-lite",
            "gemini-2.5-flash",
            "gemini-1.5-flash",
        ]
        models_to_try = list(dict.fromkeys(m for m in candidates if m))

        last_exc: Exception | None = None
        for model_name in models_to_try:
            try:
                logger.info("Calling Gemini model: %s", model_name)
                gm = genai.GenerativeModel(model_name, generation_config=self._generation_config)
                chat_session = gm.start_chat(history=gemini_history)
                response = self.call_with_retry(chat_session.send_message, prompt)
                return response.text, model_name
            except Exception as exc:
                if (
                    isinstance(exc, gexc.NotFound)
                    or "404" in str(exc)
                    or "not found" in str(exc).lower()
                ):
                    logger.warning(
                        "Gemini model '%s' not found (%s) — trying next candidate...",
                        model_name,
                        exc,
                    )
                    last_exc = exc
                    continue
                raise

        if last_exc:
            raise to_http_error(last_exc, "Generation") from last_exc
        raise HTTPException(502, "All Gemini generation models failed.")

    def embed_text(self, text: str, task_type: str = "retrieval_document") -> list[float]:
        result = self.call_with_retry(
            genai.embed_content,
            model=self.settings.embedding_model,
            content=text,
            task_type=task_type,
            output_dimensionality=self.settings.embedding_dim,
        )
        return result["embedding"]

    def embed_texts(self, texts: list[str], task_type: str = "retrieval_document") -> list[list[float]]:
        """Embed texts concurrently in batches of 20 with up to 5 worker threads."""
        batch_size = 20
        batches = [texts[i : i + batch_size] for i in range(0, len(texts), batch_size)]

        def _embed_batch(batch: list[str]) -> list[list[float]]:
            result = self.call_with_retry(
                genai.embed_content,
                model=self.settings.embedding_model,
                content=batch,
                task_type=task_type,
                output_dimensionality=self.settings.embedding_dim,
            )
            return result["embedding"]

        all_embeddings: list[list[float]] = []
        with ThreadPoolExecutor(max_workers=min(5, len(batches) or 1)) as executor:
            for batch_embeddings in executor.map(_embed_batch, batches):
                all_embeddings.extend(batch_embeddings)
        return all_embeddings
