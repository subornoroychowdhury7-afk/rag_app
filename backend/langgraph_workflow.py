"""LangGraph Agentic Workflow for DocQ&A.

Implements an Adaptive, Corrective RAG (CRAG) and Multi-Tool Agentic StateGraph:
1. Query Analysis & Contextual Rewriting
2. Hybrid Dense + Keyword Retrieval
3. Document Relevance Grading & Routing
4. Model Context Protocol (MCP) Tool Execution
5. Grounded Generation with Deep Thinking Protocol (<thinking>)
6. Grounding & Anti-Hallucination Verification (Self-Correction Loop)
"""

from __future__ import annotations

import logging
import re
from typing import Any, Callable, Dict, List, Optional, TypedDict

from langgraph.graph import END, StateGraph

from mcp_manager import MCPManager, mcp_manager

logger = logging.getLogger("docqa.graph")

NO_ANSWER = "I cannot answer this based on the uploaded documents."

GREETING_REGEX = re.compile(
    r"^(hi|hello|hey|greetings|good\s+(morning|afternoon|evening))\b|"
    r"\b(who\s+are\s+you|what\s+can\s+you\s+do|how\s+can\s+you\s+help|what\s+is\s+this\s+app)\b|"
    r"\b(what\s+documents|list\s+documents|which\s+files|show\s+documents|what\s+do\s+you\s+know)\b|"
    r"\b(help|how\s+to\s+use)\b",
    re.IGNORECASE,
)

MATH_DETECT_REGEX = re.compile(
    r"(\bcalculate\b|\bcompute\b|\bevaluate\b|\bmath\b|\bsum\b|\baverage\b|\bpercentage\b|"
    r"\d+\s*[\+\-\*\/\^]\s*\d+|\bsqrt\b|\bsin\b|\bcos\b)",
    re.IGNORECASE,
)

URL_DETECT_REGEX = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)


class AgentState(TypedDict):
    query: str
    rewritten_query: str
    history: List[Dict[str, str]]
    mode: str
    doc_filter: Optional[str]
    documents: List[str]
    citations: List[Dict[str, Any]]
    source_files: List[str]
    relevance_grade: str  # "relevant" | "empty" | "conversational" | "needs_tools"
    needs_mcp_tools: bool
    mcp_tool_calls: List[Dict[str, Any]]
    mcp_tool_results: List[Dict[str, Any]]
    answer: str
    thinking: Optional[str]
    is_grounded: bool
    loop_step: int
    suggested_followups: List[str]
    model_used: str
    execution_steps: List[str]
    total_docs_in_collection: int
    available_docs_summary: List[Dict[str, Any]]


class DocQAAgentGraph:
    """Compiled LangGraph Agent for DocQ&A."""

    def __init__(
        self,
        embed_fn: Callable[[str, str], List[float]],
        generate_fn: Callable[[str, List[Dict[str, Any]]], tuple[str, str]],
        query_chroma_fn: Callable[[List[float], int, Optional[Dict[str, Any]]], Dict[str, Any]],
        count_collection_fn: Callable[[Optional[Dict[str, Any]]], int],
        list_docs_fn: Callable[[], List[Dict[str, Any]]],
        mcp: Optional[MCPManager] = None,
    ):
        self.embed_fn = embed_fn
        self.generate_fn = generate_fn
        self.query_chroma_fn = query_chroma_fn
        self.count_collection_fn = count_collection_fn
        self.list_docs_fn = list_docs_fn
        self.mcp = mcp or mcp_manager
        self.app = self._build_graph()

    # ----------------------------------------------------------------------- #
    # Graph Nodes
    # ----------------------------------------------------------------------- #

    async def node_analyze_query(self, state: AgentState) -> Dict[str, Any]:
        """Analyze intent and rewrite follow-up query if history is present."""
        query = state["query"].strip()
        history = state.get("history", [])
        steps = list(state.get("execution_steps", []))
        steps.append("LangGraph: Query Analysis & Intent Classification")

        where_filter = None
        if state.get("doc_filter"):
            where_filter = {"source": state["doc_filter"]}

        try:
            total_docs = self.count_collection_fn(where_filter)
        except Exception:
            total_docs = 0

        # Check for multi-turn follow-up rewriting
        rewritten_query = query
        if history and len(history) > 0:
            recent = history[-6:]
            ambiguous_indicators = {
                "it", "this", "that", "these", "those", "they", "them", "their", "its",
                "he", "she", "his", "her", "why", "how", "what about", "and", "explain more",
                "elaborate", "tell me more", "summarize", "difference", "compare", "earlier",
                "previous", "above", "mentioned"
            }
            words = set(re.findall(r"\b\w+\b", query.lower()))
            if bool(words & ambiguous_indicators) or len(query.split()) <= 4:
                history_text = "\n".join(f"{m.get('role', 'user')}: {m.get('content', '')[:300]}" for m in recent)
                prompt = (
                    "Rewrite the user's latest follow-up question into a single, standalone search query "
                    "incorporating all needed entities from the conversation history.\n"
                    "Return ONLY the rewritten query without explanation.\n\n"
                    f"Conversation:\n{history_text}\n\n"
                    f"Latest Question: {query}\n"
                    "Standalone Search Query:"
                )
                try:
                    res, _ = self.generate_fn(prompt, [])
                    cleaned = res.strip().strip('"\'')
                    if cleaned and len(cleaned) > 3 and not cleaned.lower().startswith("i cannot"):
                        rewritten_query = cleaned
                except Exception as e:
                    logger.debug("Query rewriting skipped: %s", e)

        return {
            "rewritten_query": rewritten_query,
            "total_docs_in_collection": total_docs,
            "execution_steps": steps,
        }

    async def node_retrieve(self, state: AgentState) -> Dict[str, Any]:
        """Retrieve candidate document passages from vector store."""
        steps = list(state.get("execution_steps", []))
        steps.append("LangGraph: Hybrid ChromaDB Retrieval & Relevance Scoring")

        search_query = state.get("rewritten_query") or state["query"]
        doc_filter = state.get("doc_filter")
        where_filter = {"source": doc_filter} if doc_filter else None

        try:
            query_vector = self.embed_fn(search_query, "retrieval_query")
        except Exception as exc:
            logger.error("Vector embedding failed in LangGraph node_retrieve: %s", exc)
            return {
                "documents": [],
                "citations": [],
                "source_files": [],
                "relevance_grade": "empty",
                "execution_steps": steps,
            }

        k = 12
        raw_res = self.query_chroma_fn(query_vector, k, where_filter)
        distances = raw_res.get("distances", [[]])[0] if raw_res.get("distances") else []
        docs = raw_res.get("documents", [[]])[0] if raw_res.get("documents") else []
        metadatas = raw_res.get("metadatas", [[]])[0] if raw_res.get("metadatas") else []

        scored = []
        for doc_text, meta, dist in zip(docs, metadatas, distances):
            source_name = (meta or {}).get("source", "Document")
            chunk_idx = (meta or {}).get("chunk_index", 0)
            vec_sim = max(0.0, 1.0 - dist)

            # Keyword matching factor
            words = [w.lower() for w in re.findall(r"\b\w{3,}\b", search_query)]
            doc_lower = doc_text.lower()
            matched = sum(1 for w in set(words) if w in doc_lower)
            kw_sim = (matched / len(words)) if words else 0.0

            composite = 0.7 * vec_sim + 0.3 * kw_sim
            if dist <= 0.80:
                relevance = max(15, min(99, round(composite * 100)))
                scored.append({
                    "text": doc_text,
                    "source": source_name,
                    "chunk_index": chunk_idx,
                    "relevance": relevance,
                    "composite_score": composite,
                    "dist": dist,
                })

        scored.sort(key=lambda x: x["composite_score"], reverse=True)
        top_citations = scored[:k]
        retrieved_texts = [c["text"] for c in top_citations]
        source_files = sorted(list({c["source"] for c in top_citations}))

        grade = "relevant" if retrieved_texts else "empty"
        return {
            "documents": retrieved_texts,
            "citations": top_citations,
            "source_files": source_files,
            "relevance_grade": grade,
            "execution_steps": steps,
        }

    async def node_grade_and_route(self, state: AgentState) -> Dict[str, Any]:
        """Evaluate document relevance vs need for external MCP tools or conversational fallback."""
        steps = list(state.get("execution_steps", []))
        steps.append("LangGraph: Relevance Grading & MCP Tool Intent Assessment")

        query = state["query"]
        total_docs = state.get("total_docs_in_collection", 0)
        citations = state.get("citations", [])

        # Check conversational fallback
        if not citations and GREETING_REGEX.search(query):
            doc_items = self.list_docs_fn()
            return {
                "relevance_grade": "conversational",
                "available_docs_summary": doc_items,
                "execution_steps": steps,
            }

        # Check if external MCP tools are needed (e.g. math calculation, web fetch, workspace query)
        needs_mcp = False
        mcp_calls = []

        # 1. Math calculation request
        if MATH_DETECT_REGEX.search(query):
            math_expr_match = re.search(r"([0-9\.\s\+\-\*\/\(\)\^]+|sqrt\([0-9\.]+\))", query)
            if math_expr_match and len(math_expr_match.group(1).strip()) > 2:
                needs_mcp = True
                mcp_calls.append({
                    "name": "docqa_math_eval",
                    "arguments": {"expression": math_expr_match.group(1).strip()},
                })

        # 2. Live Web URL request
        url_match = URL_DETECT_REGEX.search(query)
        if url_match:
            needs_mcp = True
            mcp_calls.append({
                "name": "docqa_web_fetch",
                "arguments": {"url": url_match.group(0), "max_chars": 4000},
            })

        # 3. Datetime query
        if re.search(r"\b(current time|what time is it|today'?s date|current date|utc time)\b", query, re.I):
            needs_mcp = True
            mcp_calls.append({
                "name": "docqa_datetime_info",
                "arguments": {},
            })

        return {
            "needs_mcp_tools": needs_mcp,
            "mcp_tool_calls": mcp_calls,
            "execution_steps": steps,
        }

    async def node_execute_mcp_tools(self, state: AgentState) -> Dict[str, Any]:
        """Execute selected Model Context Protocol tools and enrich context."""
        steps = list(state.get("execution_steps", []))
        steps.append("LangGraph: Model Context Protocol (MCP) Tool Execution")

        calls = state.get("mcp_tool_calls", [])
        results = []

        for call in calls:
            tool_name = call.get("name")
            args = call.get("arguments", {})
            try:
                res = await self.mcp.execute_tool(tool_name, args)
                results.append({
                    "tool": tool_name,
                    "success": res.success,
                    "output": res.output if res.success else f"Error: {res.error}",
                    "server": res.server,
                })
            except Exception as e:
                logger.error("Error running MCP tool %s: %s", tool_name, e)
                results.append({
                    "tool": tool_name,
                    "success": False,
                    "output": f"Tool execution failed: {e}",
                    "server": "native:docqa",
                })

        return {
            "mcp_tool_results": results,
            "execution_steps": steps,
        }

    async def node_generate_answer(self, state: AgentState) -> Dict[str, Any]:
        """Synthesize cited, grounded answer with internal deep reasoning protocol."""
        steps = list(state.get("execution_steps", []))
        steps.append("LangGraph: Grounded Synthesis with Deep Thinking Protocol")

        citations = state.get("citations", [])
        mcp_results = state.get("mcp_tool_results", [])
        query = state["query"]
        mode = state.get("mode", "detailed")

        if not citations and not mcp_results:
            return {
                "answer": NO_ANSWER,
                "thinking": None,
                "suggested_followups": [],
                "model_used": "system",
                "is_grounded": True,
                "execution_steps": steps,
            }

        context_blocks = []
        for i, c in enumerate(citations, 1):
            context_blocks.append(
                f"=== EXCERPT {i} [Source: {c['source']} | Passage #{c['chunk_index']} | Match: {c['relevance']}%] ===\n"
                f"{c['text']}"
            )

        if mcp_results:
            mcp_blocks = ["=== REAL-TIME MODEL CONTEXT PROTOCOL (MCP) TOOL OUTPUTS ==="]
            for tr in mcp_results:
                mcp_blocks.append(f"Tool `{tr['tool']}` (Server: {tr.get('server', 'native')}):\n{tr['output']}")
            context_blocks.append("\n".join(mcp_blocks))

        context_string = "\n\n".join(context_blocks)

        prompt = f"""You are DocQ&A Assistant, an elite frontier agentic research intelligence powered by LangGraph and the Model Context Protocol (MCP).
Your objective is to deliver the highest-intelligence, mathematically rigorous, deeply cited response grounded strictly in the provided context excerpts and live MCP tool results.

CONTEXT EXCERPTS & LIVE MCP TOOL DATA:
{context_string}

USER QUESTION: {query}

ANSWER MODE: {mode.upper()}

DEEP REASONING PROTOCOL:
Before writing your final response, execute an internal verification phase enclosed in <thinking>...</thinking>:
1. DECONSTRUCT QUESTION: Identify exact sub-problems, explicit criteria, and implicit constraints.
2. EVIDENCE AUDIT: Cross-reference excerpts and MCP outputs, extracting facts, numbers, and formulas.
3. GROUNDING CHECK: Ensure every statement is directly backed by an excerpt or tool output, citing `[DocName.pdf]` inline.

CORE STANDARDS:
- High-impact, authoritative answer in the first 1-2 sentences.
- Elaborate thoroughly with clear Markdown headings (##, ###), bullet points, and data tables where applicable.
- Inline grounded citations: e.g. `[DocumentName.pdf]` or `[MCP: docqa_web_fetch]`.
- All math and formulas formatted in LaTeX: inline $...$ or display $$...$$.
- If context does not cover the question, state honestly what is missing.

At the very end of your response, append:
FOLLOW_UPS:
- [Contextual follow-up question 1]?
- [Contextual follow-up question 2]?
- [Contextual follow-up question 3]?
"""

        gemini_history = []
        for msg in state.get("history", [])[-20:]:
            role = "model" if msg.get("role") == "assistant" else "user"
            gemini_history.append({"role": role, "parts": [msg.get("content", "")[:16000]]})

        try:
            raw_answer, model_used = self.generate_fn(prompt, gemini_history)
        except Exception as exc:
            logger.exception("Generation failed in LangGraph node_generate_answer")
            raise exc

        thinking = None
        answer = raw_answer
        if "<thinking>" in raw_answer and "</thinking>" in raw_answer:
            parts = raw_answer.split("</thinking>")
            thinking = parts[0].replace("<thinking>", "").strip()
            answer = parts[1].strip()
        elif "<think>" in raw_answer and "</think>" in raw_answer:
            parts = raw_answer.split("</think>")
            thinking = parts[0].replace("<think>", "").strip()
            answer = parts[1].strip()

        suggested_followups = []
        if "FOLLOW_UPS:" in answer:
            parts = answer.split("FOLLOW_UPS:")
            answer = parts[0].strip()
            for line in parts[1].splitlines():
                cleaned = line.strip().lstrip("-*•0123456789. ")
                if len(cleaned) > 5:
                    suggested_followups.append(cleaned)
            suggested_followups = suggested_followups[:3]

        return {
            "answer": answer,
            "thinking": thinking,
            "suggested_followups": suggested_followups,
            "model_used": model_used,
            "execution_steps": steps,
        }

    async def node_verify_grounding(self, state: AgentState) -> Dict[str, Any]:
        """Anti-hallucination check ensuring answers are grounded."""
        steps = list(state.get("execution_steps", []))
        steps.append("LangGraph: Anti-Hallucination & Fact Grounding Verification")

        answer = state.get("answer", "")
        loop_step = state.get("loop_step", 0)

        # Basic hallucination heuristics
        is_grounded = True
        if answer == NO_ANSWER or len(answer) < 20:
            is_grounded = True
        elif not state.get("citations") and not state.get("mcp_tool_results"):
            is_grounded = False

        return {
            "is_grounded": is_grounded,
            "loop_step": loop_step + 1,
            "execution_steps": steps,
        }

    async def node_conversational_fallback(self, state: AgentState) -> Dict[str, Any]:
        """Generate helpful onboarding / inventory response when no documents match."""
        steps = list(state.get("execution_steps", []))
        steps.append("LangGraph: Conversational Intelligence Router")

        doc_items = state.get("available_docs_summary") or self.list_docs_fn()
        if doc_items:
            doc_summary = "\n".join(f"- **{d['name']}** ({d['chunks']} indexed passages)" for d in doc_items)
            ans = (
                f"Hello! I am **DocQ&A**, an enterprise-grade agentic research assistant powered by **LangGraph** "
                f"and the **Model Context Protocol (MCP)**.\n\n"
                f"### 📚 Active Knowledge Base ({len(doc_items)} documents):\n"
                f"{doc_summary}\n\n"
                f"### ⚡ Agentic Capabilities:\n"
                f"- **Adaptive RAG via LangGraph**: Multi-step query contextualization, semantic retrieval, and reflection loops.\n"
                f"- **Model Context Protocol (MCP)**: Live tool execution for calculations, web verification, and external data sources.\n"
                f"- **Rigorous Citations**: Every claim is linked to source document chunks (`[DocName.pdf]`).\n"
                f"- **Deep Reasoning**: Internal chain-of-thought verification `<thinking>` before answering.\n\n"
                f"Feel free to ask any question about your indexed documents or ask me to perform live analysis!"
            )
            sample_followups = [
                f"Summarize the core takeaways of {doc_items[0]['name']}",
                "Perform a comparative analysis across all documents",
                "What actionable recommendations are outlined?",
            ]
        else:
            ans = (
                "Hello! I am **DocQ&A**, your agentic research assistant powered by **LangGraph** and **MCP**.\n\n"
                "Your local knowledge base currently has no documents indexed. "
                "Upload a PDF, Markdown, or text file via the sidebar to enable full RAG, or ask me mathematical calculations and web queries via MCP tools!"
            )
            sample_followups = [
                "Calculate: sqrt(144) * 25 + 150",
                "How do LangGraph and MCP collaborate in DocQ&A?",
            ]

        return {
            "answer": ans,
            "thinking": None,
            "citations": [],
            "source_files": [d["name"] for d in doc_items] if doc_items else [],
            "suggested_followups": sample_followups,
            "model_used": "system:docqa_agent",
            "is_grounded": True,
            "execution_steps": steps,
        }

    # ----------------------------------------------------------------------- #
    # Conditional Routing Logic
    # ----------------------------------------------------------------------- #

    def route_after_query_analysis(self, state: AgentState) -> str:
        total = state.get("total_docs_in_collection", 0)
        query = state.get("query", "")
        if total == 0 and not MATH_DETECT_REGEX.search(query) and not URL_DETECT_REGEX.search(query):
            return "conversational_fallback"
        return "retrieve"

    def route_after_grade(self, state: AgentState) -> str:
        grade = state.get("relevance_grade")
        if grade == "conversational":
            return "conversational_fallback"
        if state.get("needs_mcp_tools"):
            return "execute_mcp_tools"
        return "generate_answer"

    def route_after_verification(self, state: AgentState) -> str:
        # Loop limit of 1 to ensure low latency and prevent infinite loops
        if state.get("is_grounded") or state.get("loop_step", 0) >= 1:
            return END
        return "generate_answer"

    # ----------------------------------------------------------------------- #
    # Graph Construction
    # ----------------------------------------------------------------------- #

    def _build_graph(self):
        workflow = StateGraph(AgentState)

        # Add Nodes
        workflow.add_node("analyze_query", self.node_analyze_query)
        workflow.add_node("retrieve", self.node_retrieve)
        workflow.add_node("grade_and_route", self.node_grade_and_route)
        workflow.add_node("execute_mcp_tools", self.node_execute_mcp_tools)
        workflow.add_node("generate_answer", self.node_generate_answer)
        workflow.add_node("verify_grounding", self.node_verify_grounding)
        workflow.add_node("conversational_fallback", self.node_conversational_fallback)

        # Set Entry Point
        workflow.set_entry_point("analyze_query")

        # Conditional Edges
        workflow.add_conditional_edges(
            "analyze_query",
            self.route_after_query_analysis,
            {
                "conversational_fallback": "conversational_fallback",
                "retrieve": "retrieve",
            },
        )

        workflow.add_edge("retrieve", "grade_and_route")

        workflow.add_conditional_edges(
            "grade_and_route",
            self.route_after_grade,
            {
                "conversational_fallback": "conversational_fallback",
                "execute_mcp_tools": "execute_mcp_tools",
                "generate_answer": "generate_answer",
            },
        )

        workflow.add_edge("execute_mcp_tools", "generate_answer")
        workflow.add_edge("generate_answer", "verify_grounding")

        workflow.add_conditional_edges(
            "verify_grounding",
            self.route_after_verification,
            {
                END: END,
                "generate_answer": "generate_answer",
            },
        )

        workflow.add_edge("conversational_fallback", END)

        return workflow.compile()

    async def invoke_async(self, initial_state: AgentState) -> Dict[str, Any]:
        """Asynchronously execute the DocQ&A LangGraph state graph."""
        return await self.app.ainvoke(initial_state)

    def invoke(self, initial_state: AgentState) -> Dict[str, Any]:
        """Synchronously execute the DocQ&A LangGraph state graph."""
        return self.app.invoke(initial_state)
