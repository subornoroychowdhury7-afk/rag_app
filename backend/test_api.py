import unittest
from fastapi.testclient import TestClient
from main import app, sanitize_filename, NO_ANSWER


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
        long_query = "x" * 2005
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


if __name__ == "__main__":
    unittest.main()
