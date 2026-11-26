"""Pydantic request and response schemas for DocQ&A API contracts."""

from typing import Optional
from pydantic import BaseModel, Field


class Message(BaseModel):
    role: str
    content: str = Field(..., max_length=32000)


class ChatRequest(BaseModel):
    query: str
    history: list[Message] = Field(default_factory=list)
    doc_filter: Optional[str] = None
    mode: Optional[str] = "detailed"


class CitationItem(BaseModel):
    text: str
    source: str
    chunk_index: int
    relevance: int
    composite_score: float
    dist: float


class ChatResponse(BaseModel):
    answer: str
    thinking: Optional[str] = None
    sources: list[str]
    source_files: list[str]
    citations: list[CitationItem]
    suggested_followups: list[str]
    model_used: Optional[str] = None


class UploadResponse(BaseModel):
    message: str
    filename: str
    chunks_processed: int


class DocumentInfo(BaseModel):
    name: str
    chunks: int


class DeleteDocumentResponse(BaseModel):
    message: str
    filename: str
    chunks_deleted: int


class DocumentSummaryResponse(BaseModel):
    filename: str
    summary: str
    total_chunks: int
    truncated: bool = False


class HealthResponse(BaseModel):
    status: str
    gemini_configured: bool
    vector_store_ready: bool
    generation_model: str
