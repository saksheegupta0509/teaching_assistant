"""
Simple in-memory store for lecture metadata + chat history.

This keeps the MVP dependency-free (no DB setup required to run it).
For production, replace this with PostgreSQL tables (see README's
"Next Steps" section) - the function signatures here are intentionally
DB-agnostic so that swap is straightforward.
"""
import uuid
from datetime import datetime
from typing import Dict, List, Optional, Any

_lectures: Dict[str, Dict[str, Any]] = {}
_chat_history: Dict[str, List[Dict[str, Any]]] = {}  # key: f"{lecture_id}:{session_id}"


def new_lecture_id() -> str:
    return str(uuid.uuid4())


def create_lecture(lecture_id: str, filename: str, title: Optional[str] = None) -> None:
    """Uploaded-recording lecture (existing flow)."""
    _lectures[lecture_id] = {
        "lecture_id": lecture_id,
        "mode": "upload",
        "filename": filename,
        "title": title or filename,
        "status": "processing",
        "progress": 0,
        "error": None,
        "num_chunks": 0,
        "next_chunk_index": 0,
        "full_text": "",
        "segments": [],
        "general_knowledge": False,
        "created_at": datetime.utcnow(),
    }


def create_live_lecture(lecture_id: str, title: Optional[str] = None) -> None:
    """Live lecture: status starts as 'live', chunks arrive one at a time."""
    _lectures[lecture_id] = {
        "lecture_id": lecture_id,
        "mode": "live",
        "filename": None,
        "title": title or f"Live Lecture {lecture_id[:8]}",
        "status": "live",
        "progress": 100,
        "error": None,
        "num_chunks": 0,
        "next_chunk_index": 0,
        "full_text": "",
        "segments": [],
        "general_knowledge": False,
        "created_at": datetime.utcnow(),
    }


def append_live_segment(lecture_id: str, text: str, start: float, end: float) -> Optional[int]:
    """Appends one finalized speech segment to a live lecture. Returns its chunk index."""
    lecture = _lectures.get(lecture_id)
    if not lecture:
        return None

    chunk_index = lecture["next_chunk_index"]
    lecture["segments"].append({"start": start, "end": end, "text": text})
    lecture["full_text"] = f"{lecture['full_text']} {text}".strip()
    lecture["next_chunk_index"] = chunk_index + 1
    # num_chunks is bumped separately, only after the embedding call to
    # ChromaDB actually succeeds - see routers/lecture.py::add_live_chunk
    return chunk_index


def stop_live_lecture(lecture_id: str) -> None:
    update_lecture(lecture_id, status="completed", progress=100)


def set_general_knowledge(lecture_id: str, enabled: bool) -> None:
    update_lecture(lecture_id, general_knowledge=enabled)


def update_lecture(lecture_id: str, **fields) -> None:
    if lecture_id in _lectures:
        _lectures[lecture_id].update(fields)


def get_lecture(lecture_id: str) -> Optional[Dict[str, Any]]:
    return _lectures.get(lecture_id)


def list_lectures() -> List[Dict[str, Any]]:
    return sorted(_lectures.values(), key=lambda l: l["created_at"], reverse=True)


def append_chat_message(lecture_id: str, session_id: str, message: Dict[str, Any]) -> None:
    key = f"{lecture_id}:{session_id}"
    _chat_history.setdefault(key, []).append(message)


def get_chat_history(lecture_id: str, session_id: str) -> List[Dict[str, Any]]:
    key = f"{lecture_id}:{session_id}"
    return _chat_history.get(key, [])
