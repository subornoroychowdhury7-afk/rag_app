"""Model Context Protocol (MCP) Manager for DocQ&A.

Handles connection to external MCP servers (stdio and SSE) and provides
built-in native DocQ&A MCP tools for real-time web fetching, mathematical
computations, system state, and RAG knowledge retrieval.
"""

from __future__ import annotations

import ast
import asyncio
import inspect
import json
import logging
import math
import operator
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import httpx

logger = logging.getLogger("docqa.mcp")

# Safe math operators for AST-based evaluation
SAFE_OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}

SAFE_MATH_FUNCTIONS = {
    "sqrt": math.sqrt,
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
    "log": math.log,
    "log10": math.log10,
    "exp": math.exp,
    "floor": math.floor,
    "ceil": math.ceil,
    "abs": abs,
    "round": round,
    "min": min,
    "max": max,
    "sum": sum,
    "pi": math.pi,
    "e": math.e,
}


def safe_eval_math(expr: str) -> float | int:
    """Safely evaluate mathematical expressions using AST parsing (no arbitrary code execution)."""
    expr = expr.strip()
    if not expr:
        raise ValueError("Empty mathematical expression.")

    node = ast.parse(expr, mode="eval").body

    def _eval(n: ast.AST) -> float | int:
        if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)):
            return n.value
        if isinstance(n, ast.BinOp):
            op_type = type(n.op)
            if op_type not in SAFE_OPERATORS:
                raise ValueError(f"Unsupported binary operator: {op_type.__name__}")
            left = _eval(n.left)
            right = _eval(n.right)
            return SAFE_OPERATORS[op_type](left, right)
        if isinstance(n, ast.UnaryOp):
            op_type = type(n.op)
            if op_type not in SAFE_OPERATORS:
                raise ValueError(f"Unsupported unary operator: {op_type.__name__}")
            return SAFE_OPERATORS[op_type](_eval(n.operand))
        if isinstance(n, ast.Call):
            if isinstance(n.func, ast.Name) and n.func.id in SAFE_MATH_FUNCTIONS:
                func = SAFE_MATH_FUNCTIONS[n.func.id]
                args = [_eval(a) for a in n.args]
                return func(*args)
            raise ValueError(f"Function call not permitted: {getattr(n.func, 'id', str(n.func))}")
        if isinstance(n, ast.Name) and n.id in SAFE_MATH_FUNCTIONS:
            return SAFE_MATH_FUNCTIONS[n.id]
        raise ValueError(f"Unsupported syntax in math expression: {type(n).__name__}")

    return _eval(node)


@dataclass
class MCPToolDefinition:
    name: str
    description: str
    input_schema: Dict[str, Any]
    server: str = "native:docqa"


@dataclass
class MCPToolResult:
    tool_name: str
    success: bool
    output: str
    error: Optional[str] = None
    server: str = "native:docqa"


class MCPManager:
    """Manages MCP tools and external server integrations for DocQ&A."""

    def __init__(self, config_path: Optional[str] = None):
        self.config_path = config_path or os.path.join(os.path.dirname(__file__), "mcp_servers.json")
        self.native_tools: Dict[str, tuple[MCPToolDefinition, Callable]] = {}
        self.external_servers: Dict[str, Dict[str, Any]] = {}
        self._load_config()
        self._register_native_tools()

    def _load_config(self) -> None:
        if os.path.exists(self.config_path):
            try:
                with open(self.config_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.external_servers = data.get("mcpServers", {})
                    logger.info("Loaded %d external MCP servers from %s", len(self.external_servers), self.config_path)
            except Exception as e:
                logger.warning("Failed to load mcp_servers.json: %s", e)
        else:
            logger.info("No mcp_servers.json found at %s. Using native DocQ&A tools.", self.config_path)

    def _register_native_tools(self) -> None:
        """Register built-in DocQ&A MCP tools that execute directly in-process."""
        # 1. Math calculation tool
        self.register_native_tool(
            MCPToolDefinition(
                name="docqa_math_eval",
                description="Safely evaluate mathematical, numerical, or statistical expressions (e.g. '1500 * (1 + 0.08)**5' or 'sqrt(144) + 25 * 3').",
                input_schema={
                    "type": "object",
                    "properties": {
                        "expression": {
                            "type": "string",
                            "description": "Mathematical formula to compute.",
                        }
                    },
                    "required": ["expression"],
                },
                server="native:docqa",
            ),
            self._tool_math_eval,
        )

        # 2. Live Web Fetch tool
        self.register_native_tool(
            MCPToolDefinition(
                name="docqa_web_fetch",
                description="Fetch and extract readable text from a URL or API endpoint for real-time external information.",
                input_schema={
                    "type": "object",
                    "properties": {
                        "url": {
                            "type": "string",
                            "description": "The HTTP/HTTPS URL to retrieve.",
                        },
                        "max_chars": {
                            "type": "integer",
                            "description": "Maximum characters to extract (default 4000).",
                            "default": 4000,
                        },
                    },
                    "required": ["url"],
                },
                server="native:docqa",
            ),
            self._tool_web_fetch,
        )

        # 3. Time and Date tool
        self.register_native_tool(
            MCPToolDefinition(
                name="docqa_datetime_info",
                description="Returns current UTC timestamp, day of week, and ISO format date.",
                input_schema={
                    "type": "object",
                    "properties": {},
                },
                server="native:docqa",
            ),
            self._tool_datetime_info,
        )

        # 4. Workspace structure explorer
        self.register_native_tool(
            MCPToolDefinition(
                name="docqa_workspace_info",
                description="Retrieve DocQ&A workspace metadata, file listing, or backend status.",
                input_schema={
                    "type": "object",
                    "properties": {
                        "subpath": {
                            "type": "string",
                            "description": "Optional relative subpath to inspect.",
                            "default": "",
                        }
                    },
                },
                server="native:docqa",
            ),
            self._tool_workspace_info,
        )

    def register_native_tool(self, definition: MCPToolDefinition, handler: Callable) -> None:
        self.native_tools[definition.name] = (definition, handler)

    async def _tool_math_eval(self, expression: str) -> str:
        try:
            val = safe_eval_math(expression)
            return f"Result: {val}"
        except Exception as e:
            return f"Math evaluation error: {e}"

    async def _tool_web_fetch(self, url: str, max_chars: int = 4000) -> str:
        if not url.startswith(("http://", "https://")):
            return "Error: URL must start with http:// or https://"
        try:
            headers = {"User-Agent": "DocQA-MCP/1.0 (+https://github.com/subornoroychowdhury7-afk/rag_app)"}
            async with httpx.AsyncClient(timeout=8.0, follow_redirects=True, headers=headers) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                text = resp.text

                # Strip script and style tags
                text = re.sub(r"<script[\s\S]*?</script>", " ", text, flags=re.IGNORECASE)
                text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.IGNORECASE)
                # Strip remaining html tags
                clean_text = re.sub(r"<[^>]+>", " ", text)
                clean_text = re.sub(r"\s+", " ", clean_text).strip()
                return clean_text[:max_chars]
        except Exception as e:
            return f"Failed to fetch {url}: {e}"

    async def _tool_datetime_info(self) -> str:
        now = datetime.now(timezone.utc)
        return (
            f"Current UTC Time: {now.strftime('%Y-%m-%d %H:%M:%S %Z')}\n"
            f"ISO-8601: {now.isoformat()}\n"
            f"Day of week: {now.strftime('%A')}"
        )

    async def _tool_workspace_info(self, subpath: str = "") -> str:
        base_dir = Path(__file__).resolve().parent.parent
        target = (base_dir / subpath).resolve()
        # Security check: ensure target stays inside base_dir
        if not str(target).startswith(str(base_dir)):
            return "Error: Access denied outside workspace root."
        if not target.exists():
            return f"Error: Path {subpath} does not exist."

        if target.is_file():
            try:
                content = target.read_text(encoding="utf-8", errors="replace")
                return f"File: {target.name}\nSize: {len(content)} chars\nPreview:\n{content[:2000]}"
            except Exception as e:
                return f"Error reading file: {e}"

        items = []
        for item in sorted(target.iterdir()):
            if item.name.startswith((".", "venv", "__pycache__", "node_modules", "chroma_db")):
                continue
            kind = "DIR " if item.is_dir() else "FILE"
            items.append(f"[{kind}] {item.name}")
        return "\n".join(items) if items else "Empty directory."

    async def list_tools(self) -> List[Dict[str, Any]]:
        """List all available MCP tools (both native and external)."""
        tools_list = []
        for name, (defn, _) in self.native_tools.items():
            tools_list.append({
                "name": defn.name,
                "description": defn.description,
                "input_schema": defn.input_schema,
                "server": defn.server,
                "is_native": True,
            })

        # Add external server tool summaries if configured and enabled
        for server_name, server_cfg in self.external_servers.items():
            if server_cfg.get("enabled"):
                tools_list.append({
                    "name": f"{server_name}_mcp_tool",
                    "description": f"External MCP tool provided by server '{server_name}': {server_cfg.get('description', '')}",
                    "input_schema": {"type": "object", "properties": {"action": {"type": "string"}}},
                    "server": f"external:{server_name}",
                    "is_native": False,
                })

        return tools_list

    async def execute_tool(self, name: str, arguments: Dict[str, Any]) -> MCPToolResult:
        """Execute a tool by name with provided arguments."""
        if name in self.native_tools:
            defn, handler = self.native_tools[name]
            try:
                if inspect.iscoroutinefunction(handler):
                    output = await handler(**arguments)
                else:
                    output = handler(**arguments)
                return MCPToolResult(tool_name=name, success=True, output=str(output), server=defn.server)
            except Exception as exc:
                logger.exception("Error executing native MCP tool %s", name)
                return MCPToolResult(tool_name=name, success=False, output="", error=str(exc), server=defn.server)

        # Check external MCP servers if configured
        for s_name, s_cfg in self.external_servers.items():
            if name.startswith(s_name) and s_cfg.get("enabled"):
                return await self._execute_external_mcp(s_name, s_cfg, name, arguments)

        return MCPToolResult(
            tool_name=name,
            success=False,
            output="",
            error=f"Tool '{name}' is not recognized by any registered MCP server.",
        )

    async def _execute_external_mcp(
        self, server_name: str, server_cfg: Dict[str, Any], tool_name: str, arguments: Dict[str, Any]
    ) -> MCPToolResult:
        """Call external MCP server via stdio transport using the official mcp SDK."""
        try:
            from mcp.client.session import ClientSession
            from mcp.client.stdio import StdioServerParameters, stdio_client

            command = server_cfg.get("command", "")
            args = server_cfg.get("args", [])
            env = server_cfg.get("env", None)

            server_params = StdioServerParameters(command=command, args=args, env=env)
            async with stdio_client(server_params) as (read_stream, write_stream):
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    res = await session.call_tool(tool_name, arguments)
                    content_texts = []
                    for c in getattr(res, "content", []):
                        if getattr(c, "type", "") == "text":
                            content_texts.append(c.text)
                    return MCPToolResult(
                        tool_name=tool_name,
                        success=True,
                        output="\n".join(content_texts) if content_texts else str(res),
                        server=f"external:{server_name}",
                    )
        except Exception as e:
            logger.error("External MCP execution failed for %s: %s", server_name, e)
            return MCPToolResult(
                tool_name=tool_name,
                success=False,
                output="",
                error=f"External MCP server '{server_name}' error: {e}",
                server=f"external:{server_name}",
            )

    def get_tools_prompt_description(self) -> str:
        """Generate formatted prompt text describing all available MCP tools."""
        lines = ["AVAILABLE MCP TOOLS:"]
        for name, (defn, _) in self.native_tools.items():
            args_str = json.dumps(defn.input_schema.get("properties", {}))
            lines.append(f"- `{defn.name}`: {defn.description} | Params: {args_str}")
        for server_name, cfg in self.external_servers.items():
            if cfg.get("enabled"):
                lines.append(f"- External server [{server_name}]: {cfg.get('description', '')}")
        return "\n".join(lines)


# Singleton instance
mcp_manager = MCPManager()
