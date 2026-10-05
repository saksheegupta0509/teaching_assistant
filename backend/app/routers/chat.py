"""
Endpoints for the student chat interface: ask a question, get a RAG-grounded
answer with source chunks + confidence, and fetch chat history.

General Knowledge ON/OFF flow (kept intentionally simple, no extra endpoints):
  1. Always try to answer from the current lecture first (RAG).
  2. If the lecture doesn't cover it AND the teacher has General Knowledge OFF
     -> return the fixed "not covered" message.
  3. If General Knowledge is ON and the student hasn't confirmed yet
     -> return a question asking if they want a general-knowledge answer
        (needs_confirmation=True). The frontend shows Yes/No buttons.
  4. If the student clicks "Yes", the frontend resends the SAME question with
     confirm_general_knowledge=True -> we call Ollama with no lecture context.
"""
from datetime import datetime

from fastapi import APIRouter, HTTPException

from app.config import get_settings
from app.models.schemas import (
    ChatQuestionRequest,
    ChatAnswerResponse,
    ChatHistoryResponse,
    ChatMessage,
    SourceChunk,
)
from app.services import store, chroma_service, ollama_service
from app.services.ollama_service import OllamaError, NOT_COVERED_MESSAGE

router = APIRouter(prefix="/api/chat", tags=["chat"])
settings = get_settings()

NOT_ENOUGH_CONTENT_MESSAGE = (
    "The lecture just started and there isn't enough content yet. "
    "Please wait a moment and try again."
)
GENERAL_KNOWLEDGE_PROMPT = (
    "I couldn't find this in the lecture. Would you like me to answer using "
    "general knowledge?"
)


@router.post("/ask", response_model=ChatAnswerResponse)
async def ask_question(payload: ChatQuestionRequest):
    lecture = store.get_lecture(payload.lecture_id)
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")
    if lecture["status"] not in ("ready", "live", "completed"):
        raise HTTPException(
            status_code=409,
            detail=f"Lecture is not ready for questions yet (status={lecture['status']})",
        )

    session_id = payload.session_id or "default"
    timestamp = datetime.utcnow()

    # Not enough lecture content indexed yet (e.g. lecture just started)
    if lecture["num_chunks"] == 0:
        return ChatAnswerResponse(
            session_id=session_id,
            question=payload.question,
            answer=NOT_ENOUGH_CONTENT_MESSAGE,
            confidence=0.0,
            covered=False,
            needs_confirmation=False,
            used_general_knowledge=False,
            sources=[],
            timestamp=timestamp,
        )

    # 1. Retrieve relevant chunks scoped to this lecture
    try:
        retrieved = chroma_service.query_chunks(
            lecture_id=payload.lecture_id,
            question=payload.question,
            top_k=settings.rag_top_k,
        )
    except OllamaError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception:
        raise HTTPException(
            status_code=500, detail="The lecture search index had a problem. Please try again."
        )

    # Filter out chunks below the minimum relevance threshold
    relevant = [c for c in retrieved if c["relevance_score"] >= settings.rag_min_relevance]

    answer = NOT_COVERED_MESSAGE
    covered = False
    confidence = 0.0
    needs_confirmation = False
    used_general_knowledge = False
    sources: list[SourceChunk] = []

    # 2. Try a grounded answer from the lecture
    if relevant:
        try:
            result = ollama_service.generate_grounded_answer(payload.question, relevant)
        except OllamaError as exc:
            raise HTTPException(status_code=503, detail=str(exc))

        covered = result["covered"]
        confidence = result["confidence"]
        answer = result["answer"]
        if covered:
            sources = [
                SourceChunk(
                    chunk_id=c["chunk_id"],
                    text=c["text"],
                    start=c["start"],
                    end=c["end"],
                    relevance_score=c["relevance_score"],
                )
                for c in relevant
            ]

    # 3. Lecture didn't cover it -> apply the General Knowledge setting
    if not covered:
        if not lecture.get("general_knowledge"):
            answer = NOT_COVERED_MESSAGE
            confidence = 0.0
        elif payload.confirm_general_knowledge:
            try:
                answer = ollama_service.generate_general_answer(payload.question)
            except OllamaError as exc:
                raise HTTPException(status_code=503, detail=str(exc))
            used_general_knowledge = True
            confidence = 0.5
        else:
            answer = GENERAL_KNOWLEDGE_PROMPT
            needs_confirmation = True
            confidence = 0.0
        sources = []

    # 4. Save both turns to chat history
    store.append_chat_message(
        payload.lecture_id,
        session_id,
        {"role": "student", "content": payload.question, "timestamp": timestamp, "sources": None, "confidence": None},
    )
    store.append_chat_message(
        payload.lecture_id,
        session_id,
        {
            "role": "assistant",
            "content": answer,
            "timestamp": timestamp,
            "sources": [s.model_dump() for s in sources],
            "confidence": confidence,
        },
    )

    return ChatAnswerResponse(
        session_id=session_id,
        question=payload.question,
        answer=answer,
        confidence=confidence,
        covered=covered,
        needs_confirmation=needs_confirmation,
        used_general_knowledge=used_general_knowledge,
        sources=sources,
        timestamp=timestamp,
    )


@router.get("/{lecture_id}/history", response_model=ChatHistoryResponse)
async def get_history(lecture_id: str, session_id: str = "default"):
    lecture = store.get_lecture(lecture_id)
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")

    raw_messages = store.get_chat_history(lecture_id, session_id)
    messages = [
        ChatMessage(
            role=m["role"],
            content=m["content"],
            timestamp=m["timestamp"],
            sources=[SourceChunk(**s) for s in m["sources"]] if m.get("sources") else None,
            confidence=m.get("confidence"),
        )
        for m in raw_messages
    ]
    return ChatHistoryResponse(lecture_id=lecture_id, session_id=session_id, messages=messages)
