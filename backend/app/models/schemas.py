"""
Pydantic request/response schemas shared across routers.
"""
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field


class LectureUploadResponse(BaseModel):
    lecture_id: str
    filename: str
    status: str
    message: str


class LectureStatus(BaseModel):
    lecture_id: str
    status: str  # "processing" | "transcribing" | "chunking" | "ready" | "live" | "completed" | "failed"
    progress: int = 0
    error: Optional[str] = None
    general_knowledge: bool = False
    num_chunks: int = 0


class TranscriptSegment(BaseModel):
    start: float
    end: float
    text: str


class TranscriptResponse(BaseModel):
    lecture_id: str
    full_text: str
    segments: List[TranscriptSegment]
    num_chunks: int


class LectureSummary(BaseModel):
    lecture_id: str
    title: str
    status: str
    mode: str = "upload"
    created_at: datetime
    num_chunks: int


class LiveLectureStartRequest(BaseModel):
    title: Optional[str] = None


class LiveChunkRequest(BaseModel):
    text: str
    start: float
    end: float


class LiveChunkResponse(BaseModel):
    lecture_id: str
    chunk_index: int
    status: str
    text: Optional[str] = None


class GeneralKnowledgeRequest(BaseModel):
    enabled: bool


class SourceChunk(BaseModel):
    chunk_id: str
    text: str
    start: float
    end: float
    relevance_score: float = Field(..., description="0-1, higher is more relevant")


class ChatQuestionRequest(BaseModel):
    lecture_id: str
    question: str
    session_id: Optional[str] = "default"
    confirm_general_knowledge: bool = Field(
        default=False,
        description="Set True when the student answered 'yes' to the general-knowledge prompt",
    )


class ChatAnswerResponse(BaseModel):
    session_id: str
    question: str
    answer: str
    confidence: float = Field(..., description="0-1 confidence in the grounded answer")
    covered: bool = Field(..., description="False if lecture did not cover this topic")
    needs_confirmation: bool = Field(
        default=False,
        description="True if the student should be asked whether to use general knowledge",
    )
    used_general_knowledge: bool = Field(default=False)
    sources: List[SourceChunk]
    timestamp: datetime


class ChatMessage(BaseModel):
    role: str  # "student" | "assistant"
    content: str
    timestamp: datetime
    sources: Optional[List[SourceChunk]] = None
    confidence: Optional[float] = None


class ChatHistoryResponse(BaseModel):
    lecture_id: str
    session_id: str
    messages: List[ChatMessage]
