"""API contract and mocked end-to-end integration tests for DocQ&A."""

import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from main import (
    GENERATION_MODEL,
    MAX_QUERY_CHARS,
    NO_ANSWER,
    app,
    chunk_text,
    compute_keyword_score,
    llm_client,
    rate_limiter,
    sanitize_filename,
    vector_store,
)
from app.config import settings


class ApiEndpointsTestCase(unittest.TestCase):
    def setUp(self):
        rate_limiter.reset()
        self.client = TestClient(app)

    def tearDown(self):
        rate_limiter.reset()

    def test_health_check_and_security_headers(self):
        res = self.client.get("/health", headers={"X-Request-ID": "trace-health-01"})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data.get("status"), "ok")
        self.assertTrue(data.get("vector_store_ready"))
        self.assertIn("gemini_configured", data)
        self.assertEqual(data["generation_model"], GENERATION_MODEL)
        self.assertEqual(res.headers.get("X-Request-ID"), "trace-health-01")
        self.assertIsNotNone(res.headers.get("X-Process-Time-Ms"))
        self.assertEqual(res.headers.get("X-Content-Type-Options"), "nosniff")
        self.assertEqual(res.headers.get("X-Frame-Options"), "DENY")

    def test_get_documents_format(self):
        res = self.client.get("/documents")
        self.assertEqual(res.status_code, 200)
        self.assertIsInstance(res.json(), list)

    def test_upload_invalid_extension(self):
        res = self.client.post(
            "/upload",
            files={"file": ("malicious.exe", b"binarycontent", "application/octet-stream")},
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("Supported formats", res.json().get("detail", ""))

    def test_upload_spoofed_pdf_rejected(self):
        res = self.client.post(
            "/upload",
            files={"file": ("spoofed.pdf", b"not actually a pdf", "application/pdf")},
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("%PDF", res.json().get("detail", ""))

    def test_upload_empty_file(self):
        res = self.client.post(
            "/upload",
            files={"file": ("empty.txt", b"", "text/plain")},
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("empty", res.json().get("detail", "").lower())

    def test_chat_empty_query_fails(self):
        res = self.client.post("/chat", json={"query": "   "})
        self.assertEqual(res.status_code, 400)

    def test_chat_query_too_long(self):
        long_query = "x" * (MAX_QUERY_CHARS + 5)
        res = self.client.post("/chat", json={"query": long_query})
        self.assertEqual(res.status_code, 400)

    def test_delete_nonexistent_document(self):
        res = self.client.delete("/documents/definitely_nonexistent_doc_12345.pdf")
        self.assertEqual(res.status_code, 404)
        self.assertIn("No document found", res.json().get("detail", ""))

    def test_summarize_nonexistent_document(self):
        res = self.client.post("/documents/definitely_nonexistent_doc_12345.pdf/summarize")
        self.assertEqual(res.status_code, 404)

    def test_sanitize_filename(self):
        self.assertEqual(sanitize_filename("../../etc/passwd.pdf"), "passwd.pdf")
        self.assertEqual(sanitize_filename("C:\\Users\\test\\doc.txt"), "doc.txt")
        self.assertEqual(sanitize_filename("normal_file.md"), "normal_file.md")

    def test_compute_keyword_score(self):
        query = "What is the SLA for 99.9% uptime?"
        doc_match = "We guarantee a 99.9% uptime SLA under all operating agreements."
        doc_unrelated = "The weather forecast predicts sunny skies and warm temperatures."
        score_match = compute_keyword_score(query, doc_match)
        score_unrelated = compute_keyword_score(query, doc_unrelated)
        self.assertGreater(score_match, 0.7)
        self.assertEqual(score_unrelated, 0.0)

    def test_chunk_text_semantic(self):
        text = "Section 1 discusses algorithms.\n\nSection 2 covers neural network embeddings."
        chunks = chunk_text(text, chunk_size=50, overlap=10)
        self.assertEqual(len(chunks), 2)
        self.assertIn("Section 1", chunks[0])
        self.assertIn("Section 2", chunks[1])

    def test_chat_long_history_allowed(self):
        res = self.client.post(
            "/chat",
            json={
                "query": "What is inside this document?",
                "history": [{"role": "assistant", "content": "x" * 6000}],
            },
        )
        self.assertNotEqual(res.status_code, 400)

    def test_mocked_end_to_end_rag_lifecycle(self):
        test_doc = "__ci_e2e_test_doc.txt"
        sample_body = (
            "DocQ&A Engineering Spec:\n"
            "Service uptime target is 99.95% monthly with P95 retrieval latency under 350ms."
        ).encode("utf-8")

        fake_vec = [0.25] * settings.embedding_dim

        try:
            with (
                patch.object(llm_client, "require_api_key", return_value=None),
                patch.object(llm_client, "embed_texts", return_value=[fake_vec]),
                patch.object(llm_client, "embed_text", return_value=fake_vec),
                patch.object(
                    llm_client,
                    "generate",
                    return_value=(
                        "<thinking>Verified SLA in excerpt.</thinking>\n"
                        "The monthly uptime target is **99.95%** [__ci_e2e_test_doc.txt].\n\n"
                        "FOLLOW_UPS:\n"
                        "- What is the P95 latency target?\n",
                        "gemini-3.8-flash",
                    ),
                ),
            ):
                up = self.client.post(
                    "/upload",
                    files={"file": (test_doc, sample_body, "text/plain")},
                )
                self.assertEqual(up.status_code, 200)
                self.assertEqual(up.json()["filename"], test_doc)

                listing = self.client.get("/documents")
                self.assertEqual(listing.status_code, 200)
                self.assertTrue(any(d["name"] == test_doc for d in listing.json()))

                chat_res = self.client.post(
                    "/chat",
                    json={"query": "What is the uptime target?", "doc_filter": test_doc},
                )
                self.assertEqual(chat_res.status_code, 200)
                body = chat_res.json()
                self.assertIn("99.95%", body["answer"])
                self.assertEqual(body["thinking"], "Verified SLA in excerpt.")
                self.assertEqual(body["source_files"], [test_doc])
                self.assertEqual(len(body["citations"]), 1)
                self.assertEqual(body["suggested_followups"], ["What is the P95 latency target?"])

                summ = self.client.post(f"/documents/{test_doc}/summarize")
                self.assertEqual(summ.status_code, 200)
                self.assertEqual(summ.json()["filename"], test_doc)
                self.assertFalse(summ.json()["truncated"])
        finally:
            vector_store.delete_document(test_doc)

    def test_chat_refuses_when_all_chunks_exceed_distance_cutoff(self):
        with (
            patch.object(llm_client, "require_api_key", return_value=None),
            patch.object(llm_client, "embed_text", return_value=[0.1] * settings.embedding_dim),
            patch.object(vector_store, "count", return_value=1),
            patch.object(
                vector_store,
                "query",
                return_value={
                    "documents": [["Completely unrelated cooking recipe."]],
                    "distances": [[0.95]],
                    "metadatas": [[{"source": "recipe.txt", "chunk_index": 0}]],
                },
            ),
        ):
            res = self.client.post("/chat", json={"query": "Explain quantum chromodynamics"})
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.json()["answer"], NO_ANSWER)

    def test_rate_limiting_returns_429_with_retry_after(self):
        original_max = rate_limiter.max_requests
        rate_limiter.max_requests = 1
        rate_limiter.reset()
        try:
            first = self.client.post("/chat", json={"query": "   "})
            # Query validation happens inside handler, after rate_limiter dependency
            self.assertEqual(first.status_code, 400)
            second = self.client.post("/chat", json={"query": "   "})
            self.assertEqual(second.status_code, 429)
            self.assertIn("Retry-After", second.headers)
        finally:
            rate_limiter.max_requests = original_max
            rate_limiter.reset()


if __name__ == "__main__":
    unittest.main()
