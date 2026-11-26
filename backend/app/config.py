"""Centralized, typed runtime configuration for DocQ&A."""

from dataclasses import dataclass
import os
from dotenv import load_dotenv

load_dotenv()


def _env_str(key: str, default: str) -> str:
    return (os.getenv(key) or default).strip()


def _env_int(key: str, default: int) -> int:
    raw = (os.getenv(key) or "").strip()
    return int(raw) if raw else default


def _env_float(key: str, default: float) -> float:
    raw = (os.getenv(key) or "").strip()
    return float(raw) if raw else default


def _env_bool(key: str, default: bool) -> bool:
    raw = (os.getenv(key) or "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    """Immutable application settings loaded from environment variables."""

    gemini_api_key: str
    embedding_model: str
    embedding_dim: int
    generation_model: str
    generation_temperature: float
    chunk_size: int
    chunk_overlap: int
    top_k: int
    max_distance: float
    max_upload_mb: int
    max_query_chars: int
    max_history_items: int
    max_retries: int
    chroma_api_key: str
    chroma_tenant: str
    chroma_database: str
    chroma_path: str
    allowed_origins: tuple[str, ...]
    rate_limit_enabled: bool
    rate_limit_requests: int
    rate_limit_window_seconds: int

    @property
    def api_key_configured(self) -> bool:
        return bool(self.gemini_api_key) and not self.gemini_api_key.startswith("your_")

    @property
    def cors_allow_credentials(self) -> bool:
        # Per the Fetch/CORS specification, credentials cannot be combined with wildcard '*'.
        return "*" not in self.allowed_origins


def load_settings() -> Settings:
    """Load settings from environment variables."""
    origins_raw = _env_str("ALLOWED_ORIGINS", "*")
    origins = tuple(o.strip() for o in origins_raw.split(",") if o.strip()) or ("*",)
    return Settings(
        gemini_api_key=_env_str("GEMINI_API_KEY", ""),
        embedding_model=_env_str("EMBEDDING_MODEL", "models/gemini-embedding-2"),
        embedding_dim=_env_int("EMBEDDING_DIM", 768),
        generation_model=_env_str("GENERATION_MODEL", "gemini-3.8-flash"),
        generation_temperature=_env_float("GENERATION_TEMPERATURE", 0.2),
        chunk_size=_env_int("CHUNK_SIZE", 1800),
        chunk_overlap=_env_int("CHUNK_OVERLAP", 300),
        top_k=_env_int("TOP_K", 12),
        max_distance=_env_float("MAX_DISTANCE", 0.78),
        max_upload_mb=_env_int("MAX_UPLOAD_MB", 20),
        max_query_chars=_env_int("MAX_QUERY_CHARS", 10000),
        max_history_items=_env_int("MAX_HISTORY_ITEMS", 100),
        max_retries=_env_int("MAX_RETRIES", 4),
        chroma_api_key=_env_str("CHROMA_API_KEY", ""),
        chroma_tenant=_env_str("CHROMA_TENANT", ""),
        chroma_database=_env_str("CHROMA_DATABASE", ""),
        chroma_path=_env_str("CHROMA_PATH", "./chroma_db"),
        allowed_origins=origins,
        rate_limit_enabled=_env_bool("RATE_LIMIT_ENABLED", True),
        rate_limit_requests=_env_int("RATE_LIMIT_REQUESTS", 60),
        rate_limit_window_seconds=_env_int("RATE_LIMIT_WINDOW_SECONDS", 60),
    )


settings = load_settings()
