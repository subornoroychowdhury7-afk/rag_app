import unittest
from fastapi.testclient import TestClient
from main import app, sanitize_filename, NO_ANSWER, compute_keyword_score, chunk_text, MAX_QUERY_CHARS, GENERATION_MODEL


class ApiEndpointsTestCase(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_health_check(self):
        res = self.client.get("/health")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data.get("status"), "ok")
        self.assertIn("gemini_configured", data)
        self.assertIn("generation_model", data)
        self.assertEqual(data["generation_model"], GENERATION_MODEL)

    def test_get_documents_format(self):
        res = self.client.get("/documents")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIsInstance(data, list)

    def test_upload_invalid_extension(self):
        res = self.client.post(
            "/upload",
            files={"file": ("malicious.exe", b"binarycontent", "application/octet-stream")},
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("Supported formats", res.json().get("detail", ""))

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
        # Long assistant responses in history (e.g. 5000+ chars) should not fail validation with 400
        res = self.client.post("/chat", json={
            "query": "What is inside this document?",
            "history": [{"role": "assistant", "content": "x" * 6000}],
        })
        self.assertNotEqual(res.status_code, 400)


if __name__ == "__main__":
    unittest.main()
