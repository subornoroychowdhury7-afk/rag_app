"""Core RAG retrieval, re-ranking, grounded answer generation, and briefing service."""

import logging
import re
from typing import Callable

from fastapi import HTTPException

from app.config import Settings
from app.schemas import ChatRequest
from app.services.document_processor import sanitize_filename
from app.services.llm_client import GeminiClient, to_http_error
from app.services.vector_store import ChromaVectorStore

logger = logging.getLogger("rag.service")

NO_ANSWER = "I cannot answer this based on the uploaded documents."
SUMMARY_MAX_CHARS = 40000

GREETING_REGEX = re.compile(
    r"^(hi|hello|hey|greetings|good\s+(morning|afternoon|evening))\b|"
    r"\b(who\s+are\s+you|what\s+can\s+you\s+do|how\s+can\s+you\s+help|what\s+is\s+this\s+app)\b|"
    r"\b(what\s+documents|list\s+documents|which\s+files|show\s+documents|what\s+do\s+you\s+know)\b|"
    r"\b(help|how\s+to\s+use)\b",
    re.IGNORECASE,
)

MODE_INSTRUCTIONS = {
    "detailed": (
        "ANSWER STYLE: IN-DEPTH & THOROUGH (Default)\n"
        "- Provide a comprehensive, multi-faceted analysis with rich supporting evidence.\n"
        "- Organize your explanation with clear Markdown headings (##, ###).\n"
        "- Include relevant quantitative figures, technical mechanisms, and criteria found in the context.\n"
        "- Use markdown comparison tables (| Col 1 | Col 2 |) whenever comparing tools, options, or metrics."
    ),
    "concise": (
        "ANSWER STYLE: EXECUTIVE & CONCISE\n"
        "- Deliver a rapid, high-impact executive summary.\n"
        "- Lead with the bottom-line takeaway in 1 sentence, followed by 3-5 crisp bullet points.\n"
        "- Focus strictly on actionable outcomes, key figures, and core findings."
    ),
    "academic": (
        "ANSWER STYLE: ACADEMIC & TECHNICAL\n"
        "- Adopt a formal, rigorous scholarly tone.\n"
        "- Provide complete mathematical formulations in LaTeX, explicit assumptions, and methodological evaluation.\n"
        "- Structure arguments methodically, highlighting evidence strength and potential boundary conditions."
    ),
    "step_by_step": (
        "ANSWER STYLE: STEP-BY-STEP PROCEDURAL GUIDE\n"
        "- Format the answer as a clear sequential guide with numbered steps (1., 2., 3.).\n"
        "- Detail any prerequisites, specific execution steps, and verification checkpoints."
    ),
}

PROMPT_TEMPLATE = """You are DocQ&A Assistant, an elite frontier research AI powered by advanced deep thinking and rigorous analytical reasoning. \
Your objective is to deliver the highest-intelligence, deeply grounded, mathematically and technically rigorous answer possible, \
grounded STRICTLY in the provided context excerpts from the user's uploaded documents.

CONTEXT EXCERPTS FROM UPLOADED DOCUMENTS:
{context_string}

USER QUESTION: {query}

{mode_instruction}

DEEP REASONING & THINKING PROTOCOL:
Before writing your final response, you MUST first execute an internal thinking and verification phase enclosed within <thinking>...</thinking> tags:
1. DECONSTRUCT QUESTION: Identify explicit questions, implicit sub-problems, and key technical criteria.
2. EVIDENCE AUDIT: Scan the provided context excerpts, extract exact figures, formulas, and facts, and cross-reference multiple passages.
3. LOGICAL REASONING: Synthesize disparate data points, evaluate edge cases, and structure an authoritative, step-by-step or comparative analysis.
4. GROUNDING & CITATION CHECK: Ensure every key factual statement is strictly backed by an excerpt, citing `[DocumentName.pdf]`.

CORE ANSWER STANDARDS:
1. EXECUTIVE CLARITY & DIRECTNESS:
   - Begin with a direct, high-impact answer to the user's question in the first 1-2 sentences.
   - Do NOT begin with meta-commentary like "Based on the provided excerpts..." or "According to the context...". Answer with natural authority.

2. DEPTH & RIGOR:
   - Elaborate thoroughly. Do not give a superficial or short response if the context contains rich details, nuances, figures, or explanations.
   - Synthesize information across multiple excerpts or documents into a coherent narrative.

3. INLINE GROUNDED CITATIONS:
   - Whenever stating a key fact, metric, formula, or finding, attribute it inline using the document name and excerpt number in brackets: e.g. `[DocumentName.pdf]` or `[DocumentName.pdf, Excerpt 1]`.
   - This provides verifiable proof for every statement.

4. STRUCTURE & TYPOGRAPHY:
   - Use Markdown headings (##, ###) to organize distinct sections.
   - Use comparison tables (`| Item | Description | Metric |`) when contrasting data points, alternatives, or features.
   - Use bullet points for itemized properties, criteria, or lists.
   - Use numbered steps for sequential workflows, chronological events, or algorithms.
   - Use **bold** typography for key terms, definitions, and critical metrics.

5. MATHEMATICS, FORMULAS & CODE:
   - Format ALL mathematical symbols, variables, and expressions using LaTeX: inline as $...$ and display equations as $$...$$.
   - Explicitly define all variables and show step-by-step mathematical reasoning.
   - Format code blocks, commands, and structured configurations in syntax-highlighted code blocks (e.g. ```python, ```bash, ```json).

6. HONEST LIMITS & PARTIAL ANSWERS:
   - If the context answers only part of the question, answer what you can with citations, and explicitly state what specific information is not covered in the excerpts.
   - If the provided context contains absolutely NO relevant information to answer the question, state exactly:
     'I cannot answer this based on the uploaded documents.'

At the very end of your answer, if the question was answerable, append EXACTLY this block:
FOLLOW_UPS:
- [Contextually relevant follow-up question 1]?
- [Contextually relevant follow-up question 2]?
- [Contextually relevant follow-up question 3]?
"""


def compute_keyword_score(query: str, text: str) -> float:
    """Calculate term frequency & exact phrase matching score between query and chunk."""
    stopwords = {
        "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "he",
        "in", "is", "it", "its", "of", "on", "that", "the", "to", "was", "were",
        "will", "with", "what", "how", "why", "who", "which", "when", "can", "could",
        "would", "should", "does", "do", "tell", "me", "about", "give", "i", "you",
    }
    tokens = [t.lower() for t in re.findall(r"\b[A-Za-z0-9_\-\.]{2,}\b", query) if t.lower() not in stopwords]
    if not tokens:
        return 0.0

    text_lower = text.lower()
    total_weight = 0.0
    matched_weight = 0.0

    clean_query = " ".join(tokens)
    if len(tokens) >= 2 and clean_query in text_lower:
        matched_weight += 2.5
        total_weight += 2.5

    for token in set(tokens):
        is_num = any(c.isdigit() for c in token)
        is_acronym = token.upper() in query and len(token) >= 2
        weight = 2.0 if (is_num or is_acronym) else 1.0
        total_weight += weight

        count = len(re.findall(r"\b" + re.escape(token) + r"\b", text_lower))
        if count > 0:
            matched_weight += weight * min(1.0 + 0.25 * (count - 1), 1.75)

    return min(1.0, matched_weight / max(total_weight, 1.0))


def strip_thinking_blocks(raw_text: str) -> tuple[str, str | None]:
    """Extract optional <thinking> or <think> block and return (clean_answer, thinking)."""
    if "<thinking>" in raw_text and "</thinking>" in raw_text:
        parts = raw_text.split("</thinking>", 1)
        return parts[1].strip(), parts[0].replace("<thinking>", "").strip()
    if "<think>" in raw_text and "</think>" in raw_text:
        parts = raw_text.split("</think>", 1)
        return parts[1].strip(), parts[0].replace("<think>", "").strip()
    return raw_text, None


def extract_followups(answer: str) -> tuple[str, list[str]]:
    """Separate trailing FOLLOW_UPS suggestions from answer prose."""
    if "FOLLOW_UPS:" not in answer:
        return answer, []
    main_text, followup_block = answer.split("FOLLOW_UPS:", 1)
    followups: list[str] = []
    for line in followup_block.splitlines():
        cleaned = line.strip().lstrip("-*•0123456789. ")
        if len(cleaned) > 5:
            followups.append(cleaned)
    return main_text.strip(), followups[:3]


def _empty_chat_payload(answer: str, **extra) -> dict:
    payload = {
        "answer": answer,
        "sources": [],
        "source_files": [],
        "citations": [],
        "suggested_followups": [],
        "model_used": "system",
    }
    payload.update(extra)
    return payload


class RAGService:
    """Orchestrates query contextualization, hybrid search, generation, and summarization."""

    def __init__(self, settings: Settings, vector_store: ChromaVectorStore, llm: GeminiClient):
        self.settings = settings
        self.vector_store = vector_store
        self.llm = llm

    def contextualize_query(
        self, query: str, history: list, generate_fn: Callable[[str, list[dict]], tuple[str, str]] | None = None
    ) -> str:
        """Rewrite follow-up questions to be self-contained for accurate vector retrieval."""
        if not history or not self.settings.api_key_configured:
            return query

        recent = history[-8:]
        ambiguous_indicators = {
            "it", "this", "that", "these", "those", "they", "them", "their", "its",
            "he", "she", "his", "her", "why", "how", "what about", "and", "explain more",
            "elaborate", "tell me more", "summarize", "difference", "compare", "step",
            "earlier", "previous", "above", "mentioned",
        }
        words = set(re.findall(r"\b\w+\b", query.lower()))
        if not (bool(words & ambiguous_indicators) or len(query.split()) <= 4):
            return query

        history_text = "\n".join(f"{m.role}: {m.content[:500]}" for m in recent)
        prompt = (
            "Given the conversation history and the user's latest follow-up question, rewrite the question "
            "into a single, standalone search query that includes all relevant subjects, entities, and context "
            "needed to retrieve relevant document excerpts.\n"
            "Do NOT answer the question. Return ONLY the rewritten query text without explanation.\n\n"
            f"Conversation History:\n{history_text}\n\n"
            f"Latest Question: {query}\n"
            "Standalone Search Query:"
        )
        gen = generate_fn or self.llm.generate
        try:
            res_text, _ = gen(prompt, [])
            rewritten = res_text.strip().strip("\"'")
            if rewritten and len(rewritten) > 3 and not rewritten.lower().startswith("i cannot"):
                return rewritten
        except Exception as exc:
            logger.debug("Gemini query rewriting skipped: %s", exc)
        return query

    def answer_question(
        self,
        request: ChatRequest,
        embed_fn: Callable[[str, str], list[float]] | None = None,
        generate_fn: Callable[[str, list[dict]], tuple[str, str]] | None = None,
    ) -> dict:
        """Run end-to-end grounded RAG pipeline for a user chat request."""
        query = request.query.strip()
        if not query:
            raise HTTPException(400, "Query must not be empty.")
        if len(query) > self.settings.max_query_chars:
            raise HTTPException(400, f"Query is too long (limit is {self.settings.max_query_chars} characters).")
        self.llm.require_api_key()

        source_filter = (
            sanitize_filename(request.doc_filter)
            if request.doc_filter and request.doc_filter.strip()
            else None
        )
        total = self.vector_store.count(source_filter)

        if total == 0:
            if GREETING_REGEX.search(query):
                return _empty_chat_payload(
                    "Hello! I am your **DocQ&A Assistant**. You currently do not have any documents indexed. "
                    "Please upload a PDF, Markdown, or text file using the sidebar to begin asking questions!"
                )
            return _empty_chat_payload(NO_ANSWER)

        embed = embed_fn or self.llm.embed_text
        generate = generate_fn or self.llm.generate
        search_query = self.contextualize_query(query, request.history, generate_fn=generate)

        try:
            query_vector = embed(search_query, "retrieval_query")
        except Exception as exc:
            logger.exception("Query embedding failed")
            raise to_http_error(exc, "Embedding") from exc

        candidate_k = min(self.settings.top_k * 2, total)
        results = self.vector_store.query(query_vector, candidate_k, source_filter)
        distances: list[float] = results["distances"][0] if results.get("distances") else []
        docs: list[str] = results["documents"][0] if results.get("documents") else []
        metadatas: list[dict] = results["metadatas"][0] if results.get("metadatas") else []

        scored_candidates = []
        for doc, meta, dist in zip(docs, metadatas, distances):
            source_name = (meta or {}).get("source", "Document")
            chunk_idx = (meta or {}).get("chunk_index", 0)
            vec_sim = max(0.0, 1.0 - dist)
            kw_sim = compute_keyword_score(search_query, doc)

            composite_score = (0.65 * vec_sim + 0.35 * kw_sim) if kw_sim > 0 else (0.85 * vec_sim)
            effective_cutoff = self.settings.max_distance + (0.08 if kw_sim > 0.3 else 0.0)
            if dist <= effective_cutoff:
                relevance = max(15, min(99, round(composite_score * 100)))
                scored_candidates.append(
                    {
                        "text": doc,
                        "source": source_name,
                        "chunk_index": chunk_idx,
                        "relevance": relevance,
                        "composite_score": composite_score,
                        "dist": dist,
                    }
                )

        scored_candidates.sort(key=lambda x: x["composite_score"], reverse=True)
        citations = scored_candidates[: self.settings.top_k]
        retrieved_chunks = [c["text"] for c in citations]
        source_files = sorted(list({c["source"] for c in citations}))

        if not retrieved_chunks:
            return self._fallback_when_no_chunks(query)

        context_blocks = [
            f"=== EXCERPT {i} [Source: {c['source']} | Passage #{c['chunk_index']} | Match: {c['relevance']}%] ===\n{c['text']}"
            for i, c in enumerate(citations, 1)
        ]
        mode_key = (request.mode or "detailed").lower()
        mode_instruction = MODE_INSTRUCTIONS.get(mode_key, MODE_INSTRUCTIONS["detailed"])
        prompt = PROMPT_TEMPLATE.format(
            context_string="\n\n".join(context_blocks),
            query=query,
            mode_instruction=mode_instruction,
        )

        gemini_history = [
            {
                "role": "model" if msg.role == "assistant" else "user",
                "parts": [msg.content[:16000]],
            }
            for msg in request.history[-self.settings.max_history_items :]
        ]

        try:
            raw_answer, model_used = generate(prompt, gemini_history)
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Generation failed")
            raise to_http_error(exc, "Generation") from exc

        answer, thinking = strip_thinking_blocks(raw_answer)
        answer, suggested_followups = extract_followups(answer)

        return {
            "answer": answer,
            "thinking": thinking,
            "sources": retrieved_chunks,
            "source_files": source_files,
            "citations": citations,
            "suggested_followups": suggested_followups,
            "model_used": model_used,
        }

    def _fallback_when_no_chunks(self, query: str) -> dict:
        if GREETING_REGEX.search(query):
            doc_items = self.vector_store.list_documents()
            if doc_items:
                doc_summary = "\n".join(f"- **{d['name']}** ({d['chunks']} indexed passages)" for d in doc_items)
                greeting_answer = (
                    "Hello! I am your **DocQ&A Assistant**, ready to help you analyze and extract verified insights "
                    "from your knowledge base.\n\n"
                    f"### 📚 Available Documents ({len(doc_items)} total):\n"
                    f"{doc_summary}\n\n"
                    "### 💡 What I Can Help You With:\n"
                    "- **In-depth Q&A**: Ask targeted questions and get comprehensive answers with inline citations `[DocumentName.pdf]`.\n"
                    "- **Cross-Document Synthesis**: Compare findings, metrics, and arguments across multiple files.\n"
                    "- **Technical & Mathematical Reasoning**: Step-by-step problem solving with clean LaTeX formulas ($E=mc^2$).\n"
                    "- **Executive Briefings**: Summaries, data tables, and structured procedural guides.\n\n"
                    "Try asking a question about any of your documents above to begin!"
                )
                sample_followups = [
                    f"What are the key findings in {doc_items[0]['name']}?",
                    "Can you summarize the main themes across all documents?",
                    "What actionable takeaways are outlined in the files?",
                ]
                return _empty_chat_payload(
                    greeting_answer,
                    source_files=[d["name"] for d in doc_items],
                    suggested_followups=sample_followups,
                )
            return _empty_chat_payload(
                "Hello! I am your **DocQ&A Assistant**. You currently do not have any documents uploaded. "
                "Please upload a PDF, Markdown, or text file via the sidebar to get started!"
            )

        return _empty_chat_payload(NO_ANSWER)

    def summarize_document(
        self, filename: str, generate_fn: Callable[[str, list[dict]], tuple[str, str]] | None = None
    ) -> dict:
        """Generate an executive-grade AI briefing for an indexed document."""
        clean_name = sanitize_filename(filename)
        self.llm.require_api_key()

        ordered_chunks = self.vector_store.get_ordered_chunks(clean_name)
        if not ordered_chunks:
            raise HTTPException(404, f"No content found for document '{clean_name}'.")

        combined_text = "\n\n".join(ordered_chunks)
        truncated = len(combined_text) > SUMMARY_MAX_CHARS
        text_sample = combined_text[:SUMMARY_MAX_CHARS]

        summary_prompt = f"""You are an expert executive research analyst. Generate a comprehensive, professional executive briefing based ONLY on the provided document text.

Format your output in clean, elegant Markdown using the following four sections:

### 📌 Executive Overview
A concise paragraph synthesizing the primary objective, context, and core thesis of the document.

### 💡 Key Highlights & Critical Data
- 3 to 5 bullet points highlighting the most significant findings, metrics, dates, or qualitative insights.

### 🎯 Strategic Takeaways & Recommendations
- 2 to 4 actionable conclusions, key risks, or next steps outlined or implied by the document.

### ❓ Recommended Follow-up Inquiries
- 3 thoughtful questions an analyst or executive should explore next based on this document.

Document Name: {clean_name}
Document Content:
{text_sample}
"""
        gen = generate_fn or self.llm.generate
        try:
            raw_summary, _ = gen(summary_prompt, [])
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Summarization failed for %s", clean_name)
            raise to_http_error(exc, "Summarization") from exc

        summary_md, _ = strip_thinking_blocks(raw_summary)
        return {
            "filename": clean_name,
            "summary": summary_md,
            "total_chunks": len(ordered_chunks),
            "truncated": truncated,
        }
