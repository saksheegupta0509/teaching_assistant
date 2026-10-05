"""
ChromaDB integration: stores lecture transcript chunks as embeddings and
retrieves the most relevant chunks for a given student question.

Embeddings are generated locally via Ollama (nomic-embed-text by default)
and Chroma persists to disk so lectures survive a backend restart.
"""
from functools import lru_cache
from typing import List, Dict, Any

import chromadb
import httpx
from chromadb.utils import embedding_functions

from app.config import get_settings
from app.services.ollama_service import OllamaError

settings = get_settings()


@lru_cache
def _get_client():
    return chromadb.PersistentClient(path=settings.chroma_persist_dir)


@lru_cache
def _get_embedding_fn():
    return embedding_functions.OllamaEmbeddingFunction(
        url=f"{settings.ollama_base_url}/api/embeddings",
        model_name=settings.ollama_embedding_model,
    )


@lru_cache
def _get_collection():
    client = _get_client()
    return client.get_or_create_collection(
        name=settings.chroma_collection_name,
        embedding_function=_get_embedding_fn(),
        metadata={"hnsw:space": "cosine"},
    )


def add_chunks(lecture_id: str, chunks: List[Dict[str, Any]], start_index: int = 0) -> int:
    """
    Adds transcript chunks for a lecture to the vector store.
    Each chunk dict must have: text, start, end.

    `start_index` offsets the chunk_index / id used for each chunk - this
    matters for live lectures, where chunks are added one at a time as they
    arrive (each call would otherwise reuse id "chunk::0" and overwrite the
    previous one).

    Returns number of chunks added.
    """
    if not chunks:
        return 0

    collection = _get_collection()

    ids = [f"{lecture_id}::chunk::{start_index + i}" for i in range(len(chunks))]
    documents = [c["text"] for c in chunks]
    metadatas = [
        {
            "lecture_id": lecture_id,
            "chunk_index": start_index + i,
            "start": c["start"],
            "end": c["end"],
        }
        for i, c in enumerate(chunks)
    ]

    try:
        collection.upsert(ids=ids, documents=documents, metadatas=metadatas)
    except httpx.ConnectError as exc:
        raise OllamaError(
            "Can't reach Ollama to generate embeddings. Make sure it's running (`ollama serve`)."
        ) from exc

    return len(chunks)


def query_chunks(lecture_id: str, question: str, top_k: int = 4) -> List[Dict[str, Any]]:
    """
    Retrieves the top_k most relevant chunks for `question`, scoped to a
    single lecture_id. Returns list of {chunk_id, text, start, end, relevance_score}
    sorted by descending relevance (1.0 = perfect match, 0.0 = unrelated).
    """
    collection = _get_collection()

    try:
        results = collection.query(
            query_texts=[question],
            n_results=top_k,
            where={"lecture_id": lecture_id},
        )
    except httpx.ConnectError as exc:
        raise OllamaError(
            "Can't reach Ollama to generate embeddings. Make sure it's running (`ollama serve`)."
        ) from exc

    if not results["ids"] or not results["ids"][0]:
        return []

    out = []
    for i in range(len(results["ids"][0])):
        distance = results["distances"][0][i]  # cosine distance, 0 = identical
        relevance = max(0.0, 1.0 - distance)
        out.append(
            {
                "chunk_id": results["ids"][0][i],
                "text": results["documents"][0][i],
                "start": results["metadatas"][0][i]["start"],
                "end": results["metadatas"][0][i]["end"],
                "relevance_score": round(relevance, 4),
            }
        )

    return out


def delete_lecture(lecture_id: str) -> None:
    collection = _get_collection()
    collection.delete(where={"lecture_id": lecture_id})


def lecture_chunk_count(lecture_id: str) -> int:
    collection = _get_collection()
    result = collection.get(where={"lecture_id": lecture_id})
    return len(result["ids"]) if result and result.get("ids") else 0
