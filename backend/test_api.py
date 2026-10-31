import unittest
from fastapi.testclient import TestClient
from main import app, sanitize_filename, NO_ANSWER, compute_keyword_score, chunk_text, MAX_QUERY_CHARS, HF_API_OK, HF_MODELS, select_models_for_workflow


class ApiEndpointsTestCase(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_health_check(self):
        res = self.client.get("/health")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data.get("status"), "ok")
        self.assertIn("gemini_configured", data)

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



    def test_health_includes_hf_config(self):
        res = self.client.get("/health")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("hf_configured", data)
        self.assertIn("hf_models_count", data)
        self.assertIsInstance(data["hf_configured"], bool)
        self.assertEqual(data["hf_models_count"], len(HF_MODELS))

    def test_hf_models_list_not_empty(self):
        self.assertGreater(len(HF_MODELS), 0)
        for m in HF_MODELS:
            self.assertIsInstance(m, str)
            self.assertGreater(len(m), 0)


    def test_workflow_model_selection(self):
        # Academic / Mathematical workflow -> DeepSeek-R1-Distill-Qwen-32B preferred first
        academic_models = select_models_for_workflow("Compute eigenvalues", mode="academic")
        self.assertEqual(academic_models[0], "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B")
        self.assertEqual(len(academic_models), len(HF_MODELS))

        # Coding / Step-by-Step workflow -> Qwen2.5-Coder-32B-Instruct preferred first
        coding_models = select_models_for_workflow("Write a Python API client function", mode="step_by_step")
        self.assertEqual(coding_models[0], "Qwen/Qwen2.5-Coder-32B-Instruct")
        self.assertEqual(len(coding_models), len(HF_MODELS))

        # Concise workflow -> Mistral-Small preferred first
        concise_models = select_models_for_workflow("Executive summary", mode="concise")
        self.assertEqual(concise_models[0], "mistralai/Mistral-Small-24B-Instruct-2501")
        self.assertEqual(len(concise_models), len(HF_MODELS))

if __name__ == "__main__":
    unittest.main()
