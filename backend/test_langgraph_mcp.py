"""Test suite for DocQ&A LangGraph and Model Context Protocol (MCP) integrations."""

import unittest
from fastapi.testclient import TestClient
from main import app


class LangGraphMcpTestCase(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_health_check_features(self):
        res = self.client.get("/health")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data.get("app"), "DocQ&A")
        self.assertTrue(data.get("langgraph_enabled"))
        self.assertTrue(data.get("mcp_enabled"))

    def test_graph_info_endpoint(self):
        res = self.client.get("/graph/info")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data.get("name"), "DocQAAgentGraph")
        self.assertEqual(data.get("framework"), "LangGraph")
        self.assertIn("analyze_query", data.get("nodes", []))
        self.assertIn("execute_mcp_tools", data.get("nodes", []))
        self.assertIn("verify_grounding", data.get("nodes", []))

    def test_mcp_list_tools(self):
        res = self.client.get("/mcp/tools")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("tools", data)
        tool_names = [t["name"] for t in data["tools"]]
        self.assertIn("docqa_math_eval", tool_names)
        self.assertIn("docqa_web_fetch", tool_names)
        self.assertIn("docqa_datetime_info", tool_names)
        self.assertIn("docqa_workspace_info", tool_names)

    def test_mcp_execute_math(self):
        res = self.client.post(
            "/mcp/execute",
            json={
                "tool": "docqa_math_eval",
                "arguments": {"expression": "100 * 2 + sqrt(64)"},
            },
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data.get("success"))
        self.assertIn("208", data.get("output", ""))

    def test_mcp_execute_datetime(self):
        res = self.client.post(
            "/mcp/execute",
            json={
                "tool": "docqa_datetime_info",
                "arguments": {},
            },
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data.get("success"))
        self.assertIn("UTC", data.get("output", ""))

    def test_chat_pipeline_metadata(self):
        # Query that invokes greeting / conversational router
        res = self.client.post(
            "/chat",
            json={"query": "Hello! What can you do?"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("answer", data)
        self.assertEqual(data.get("pipeline"), "langgraph-agentic-crag")
        self.assertIn("execution_steps", data)
        self.assertIsInstance(data.get("execution_steps"), list)
        self.assertIn("mcp_tools_used", data)


if __name__ == "__main__":
    unittest.main()
