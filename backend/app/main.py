"""
FastAPI application entrypoint for the AI Teaching Assistant MVP backend.

Run with:
    uvicorn app.main:app --reload --port 8000
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import lecture, chat

settings = get_settings()

app = FastAPI(
    title="AI Teaching Assistant API",
    description="RAG-powered teaching assistant: lecture transcription + grounded Q&A",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(lecture.router)
app.include_router(chat.router)


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "ai-teaching-assistant-backend"}
