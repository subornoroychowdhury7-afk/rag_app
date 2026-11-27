"""Vector store repository abstraction backed by ChromaDB (local or Cloud)."""

import logging
import os
from typing import Optional
import uuid

import chromadb

from app.config import Settings

logger = logging.getLogger("rag.vector_store")


class ChromaVectorStore:
    """Repository wrapping ChromaDB document ingestion, querying, listing, and deletion."""

    def __init__(self, settings: Settings):
        if settings.chroma_api_key:
            try:
                self.client = chromadb.CloudClient(
                    tenant=settings.chroma_tenant,
                    database=settings.chroma_database,
                    api_key=settings.chroma_api_key,
                )
                index_config = {"spann": {"space": "cosine"}}
                logger.info("Using Chroma Cloud")
                self.collection = self._get_or_create_collection(index_config)
                return
            except Exception as exc:
                logger.warning(
                    "Chroma Cloud unavailable (%s); falling back to local PersistentClient at %s",
                    exc,
                    settings.chroma_path,
                )

        self.client, index_config = self._init_local_client(settings)
        self.collection = self._get_or_create_collection(index_config)

    @staticmethod
    def _init_local_client(settings: Settings):
        os.makedirs(os.path.abspath(settings.chroma_path), exist_ok=True)
        client = chromadb.PersistentClient(path=settings.chroma_path)
        index_config = {"hnsw": {"space": "cosine"}}
        logger.info("Using local ChromaDB at %s", settings.chroma_path)
        return client, index_config

    def _get_or_create_collection(self, index_config: dict):
        try:
            return self.collection_or_create(index_config)
        except Exception:
            return self.client.get_or_create_collection(name="rag_collection")

    def collection_or_create(self, index_config: dict):
        return self.client.get_or_create_collection(
            name="rag_collection", configuration=index_config
        )

    def ping(self) -> bool:
        """Verify vector store connectivity and collection readiness."""
        try:
            self.collection.count()
            return True
        except Exception as exc:
            logger.warning("Vector store readiness check failed: %s", exc)
            return False

    def upsert_document(self, filename: str, chunks: list[str], embeddings: list[list[float]]) -> None:
        """Replace existing chunks for filename and insert new embedded chunks."""
        try:
            previous = self.collection.get(where={"source": filename}, include=[])["ids"]
            if previous:
                self.collection.delete(ids=previous)
        except Exception as exc:
            logger.warning("Could not check previous chunks for %s: %s", filename, exc)

        self.collection.add(
            ids=[str(uuid.uuid4()) for _ in chunks],
            embeddings=embeddings,
            documents=chunks,
            metadatas=[{"source": filename, "chunk_index": i} for i in range(len(chunks))],
        )

    def list_documents(self) -> list[dict]:
        """List all indexed documents and their chunk counts."""
        try:
            results = self.collection.get(include=["metadatas"])
            metadatas = results.get("metadatas") or []
            docs: dict[str, int] = {}
            for meta in metadatas:
                source = (meta or {}).get("source", "unknown")
                docs[source] = docs.get(source, 0) + 1
            return [{"name": name, "chunks": count} for name, count in sorted(docs.items())]
        except Exception as exc:
            logger.warning("Failed to retrieve documents: %s", exc)
            return []

    def delete_document(self, filename: str) -> int:
        """Delete all chunks for filename and return deleted count."""
        results = self.collection.get(where={"source": filename}, include=[])
        doc_ids = results.get("ids") or []
        if not doc_ids:
            return 0
        self.collection.delete(ids=doc_ids)
        logger.info("Deleted %d chunks for '%s'", len(doc_ids), filename)
        return len(doc_ids)

    def count(self, source_filter: Optional[str] = None) -> int:
        if source_filter:
            return len(self.collection.get(where={"source": source_filter}, include=[])["ids"])
        return self.collection.count()

    def query(
        self, query_vector: list[float], n_results: int, source_filter: Optional[str] = None
    ) -> dict:
        query_kwargs = {
            "query_embeddings": [query_vector],
            "n_results": n_results,
            "include": ["documents", "distances", "metadatas"],
        }
        if source_filter:
            query_kwargs["where"] = {"source": source_filter}
        return self.collection.query(**query_kwargs)

    def get_ordered_chunks(self, filename: str) -> list[str]:
        """Return chunks belonging to filename sorted sequentially by chunk_index."""
        results = self.collection.get(where={"source": filename}, include=["documents", "metadatas"])
        docs = results.get("documents") or []
        if not docs:
            return []
        metas = results.get("metadatas") or []
        indexed = sorted(
            (((meta or {}).get("chunk_index", 0), doc) for doc, meta in zip(docs, metas)),
            key=lambda x: x[0],
        )
        return [text for _, text in indexed]
