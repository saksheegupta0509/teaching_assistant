"""
Centralized application configuration.
Reads values from environment variables / .env file.
"""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Ollama (local LLM + embeddings, no API key needed)
    ollama_base_url: str = "http://localhost:11434"
    ollama_chat_model: str = "llama3.2"
    ollama_embedding_model: str = "nomic-embed-text"

    # Whisper
    whisper_model_size: str = "base"
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"

    # ChromaDB
    chroma_persist_dir: str = "./chroma_db"
    chroma_collection_name: str = "lecture_chunks"

    # Storage
    upload_dir: str = "./storage/uploads"
    transcript_dir: str = "./storage/transcripts"

    # Chunking
    chunk_size_chars: int = 800
    chunk_overlap_chars: int = 150

    # RAG
    rag_top_k: int = 4
    rag_min_relevance: float = 0.25

    # CORS
    frontend_origin: str = "http://localhost:3000"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
