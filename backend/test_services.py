"""Unit tests for modular backend services, security controls, and configuration."""

import unittest

from unittest.mock import patch

from fastapi import HTTPException

from app.config import Settings
from app.middleware import SlidingWindowRateLimiter
from app.services.document_processor import (
    chunk_text,
    extract_document_text,
    sanitize_filename,
    validate_upload_bytes,
)
from app.services.rag_service import extract_followups, strip_thinking_blocks
from app.services.vector_store import ChromaVectorStore


class ServicesUnitTestCase(unittest.TestCase):
    def test_validate_pdf_magic_bytes_rejects_spoofed_pdf(self):
        with self.assertRaises(HTTPException) as ctx:
            validate_upload_bytes("fake.pdf", b"This is plain text pretending to be PDF")
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("%PDF", ctx.exception.detail)

    def test_validate_pdf_magic_bytes_accepts_valid_header(self):
        clean = validate_upload_bytes("../../report.pdf", b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\n")
        self.assertEqual(clean, "report.pdf")

    def test_validate_text_rejects_binary_nul_bytes(self):
        with self.assertRaises(HTTPException) as ctx:
            validate_upload_bytes("notes.md", b"hello\x00world")
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("binary", ctx.exception.detail.lower())

    def test_extract_document_text_decodes_utf8_with_replacement(self):
        text = extract_document_text("doc.txt", b"Valid \xff\xfe text")
        self.assertIn("Valid", text)
        self.assertIn("text", text)

    def test_chunk_text_empty_returns_empty(self):
        self.assertEqual(chunk_text("   \n\n  "), [])

    def test_strip_thinking_blocks_and_extract_followups(self):
        raw = (
            "<thinking>Step 1: Verify.</thinking>\n"
            "Revenue grew 25% [Q4.pdf].\n\n"
            "FOLLOW_UPS:\n"
            "- What drove Q4 margin growth?\n"
            "- How did EMEA perform?\n"
        )
        clean, thinking = strip_thinking_blocks(raw)
        self.assertEqual(thinking, "Step 1: Verify.")
        answer, followups = extract_followups(clean)
        self.assertEqual(answer, "Revenue grew 25% [Q4.pdf].")
        self.assertEqual(
            followups,
            ["What drove Q4 margin growth?", "How did EMEA perform?"],
        )

    def test_cors_credentials_disabled_for_wildcard(self):
        base_kwargs = dict(
            gemini_api_key="test",
            embedding_model="models/gemini-embedding-2",
            embedding_dim=768,
            generation_model="gemini-3.8-flash",
            generation_temperature=0.2,
            chunk_size=1800,
            chunk_overlap=300,
            top_k=12,
            max_distance=0.78,
            max_upload_mb=20,
            max_query_chars=10000,
            max_history_items=100,
            max_retries=4,
            chroma_api_key="",
            chroma_tenant="",
            chroma_database="",
            chroma_path="./chroma_db",
            rate_limit_enabled=True,
            rate_limit_requests=60,
            rate_limit_window_seconds=60,
        )
        wildcard = Settings(**base_kwargs, allowed_origins=("*",))
        explicit = Settings(**base_kwargs, allowed_origins=("https://rag-app-three-tau.vercel.app",))
        self.assertFalse(wildcard.cors_allow_credentials)
        self.assertTrue(explicit.cors_allow_credentials)

    def test_rate_limiter_enforces_limit_and_resets(self):
        limiter = SlidingWindowRateLimiter(max_requests=2, window_seconds=60, enabled=True)
        limiter.check("10.0.0.1")
        limiter.check("10.0.0.1")
        with self.assertRaises(HTTPException) as ctx:
            limiter.check("10.0.0.1")
        self.assertEqual(ctx.exception.status_code, 429)
        self.assertIn("Retry-After", ctx.exception.headers)
        limiter.reset()
        limiter.check("10.0.0.1")

    def test_sanitize_filename_strips_traversal(self):
        self.assertEqual(sanitize_filename("../secret/../../notes?.md"), "notes_.md")

    def test_chroma_cloud_failure_falls_back_to_local_store(self):
        cfg = Settings(
            gemini_api_key="test",
            embedding_model="models/gemini-embedding-2",
            embedding_dim=768,
            generation_model="gemini-3.8-flash",
            generation_temperature=0.2,
            chunk_size=1800,
            chunk_overlap=300,
            top_k=12,
            max_distance=0.78,
            max_upload_mb=20,
            max_query_chars=10000,
            max_history_items=100,
            max_retries=4,
            chroma_api_key="bad-cloud-key",
            chroma_tenant="tenant",
            chroma_database="db",
            chroma_path="./chroma_db",
            allowed_origins=("*",),
            rate_limit_enabled=True,
            rate_limit_requests=60,
            rate_limit_window_seconds=60,
        )
        with patch("app.services.vector_store.chromadb.CloudClient", side_effect=RuntimeError("Permission denied")):
            store = ChromaVectorStore(cfg)
        self.assertTrue(store.ping())


if __name__ == "__main__":
    unittest.main()
