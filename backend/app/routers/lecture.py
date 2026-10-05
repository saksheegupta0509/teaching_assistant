"""
Endpoints for teachers to upload lecture audio/video, trigger
transcription (Whisper), chunk the transcript, and store it in ChromaDB.
"""
import os
import traceback
import uuid
from typing import List, Optional

from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks, Form

from app.config import get_settings
from app.models.schemas import (
    LectureUploadResponse,
    LectureStatus,
    TranscriptResponse,
    TranscriptSegment,
    LectureSummary,
    LiveLectureStartRequest,
    LiveChunkRequest,
    LiveChunkResponse,
    GeneralKnowledgeRequest,
)
from app.services import store, chroma_service
from app.services.whisper_service import transcribe_audio
from app.services.chunking import chunk_segments
from app.services.ollama_service import OllamaError

router = APIRouter(prefix="/api/lecture", tags=["lecture"])
settings = get_settings()

ALLOWED_EXTENSIONS = {".mp3", ".wav", ".m4a", ".mp4", ".mov", ".webm", ".ogg", ".flac"}


def _process_lecture(lecture_id: str, file_path: str) -> None:
    """Runs in the background: transcribe -> chunk -> embed & store."""
    try:
        store.update_lecture(lecture_id, status="transcribing", progress=20)
        result = transcribe_audio(file_path)

        store.update_lecture(
            lecture_id,
            status="chunking",
            progress=60,
            full_text=result["full_text"],
            segments=result["segments"],
        )

        chunks = chunk_segments(
            result["segments"],
            chunk_size_chars=settings.chunk_size_chars,
            overlap_chars=settings.chunk_overlap_chars,
        )

        num_added = chroma_service.add_chunks(lecture_id, chunks)

        store.update_lecture(
            lecture_id,
            status="ready",
            progress=100,
            num_chunks=num_added,
        )
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        store.update_lecture(
            lecture_id, status="failed", error=str(exc), progress=0
        )


@router.post("/upload", response_model=LectureUploadResponse)
async def upload_lecture(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    title: str = Form(None),
):
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Allowed: {sorted(ALLOWED_EXTENSIONS)}",
        )

    os.makedirs(settings.upload_dir, exist_ok=True)
    lecture_id = store.new_lecture_id()
    dest_path = os.path.join(settings.upload_dir, f"{lecture_id}{ext}")

    with open(dest_path, "wb") as out_file:
        content = await file.read()
        out_file.write(content)

    store.create_lecture(lecture_id, filename=file.filename, title=title)

    background_tasks.add_task(_process_lecture, lecture_id, dest_path)

    return LectureUploadResponse(
        lecture_id=lecture_id,
        filename=file.filename,
        status="processing",
        message="Upload received. Transcription started in the background.",
    )


@router.post("/live/start", response_model=LectureUploadResponse)
async def start_live_lecture(payload: LiveLectureStartRequest):
    """Teacher clicks 'Start Live Lecture'. No file needed - transcript chunks
    are pushed in one at a time as the teacher speaks (see /live/{id}/chunk)."""
    lecture_id = store.new_lecture_id()
    store.create_live_lecture(lecture_id, title=payload.title)
    return LectureUploadResponse(
        lecture_id=lecture_id,
        filename="live-lecture",
        status="live",
        message="Live lecture started.",
    )


def _index_live_text(lecture_id: str, text: str, start: float, end: float) -> Optional[int]:
    """
    Stores + embeds one finalized piece of live-lecture text. Shared by both
    /live/{id}/chunk (text arrives already transcribed, e.g. from the
    browser's Web Speech API) and /live/{id}/audio-chunk (text comes from
    Whisper below) - there is exactly one place that talks to ChromaDB for
    live chunks, not two.

    Returns the new chunk_index, or None if there was no usable text.
    """
    text = text.strip()
    if not text:
        return None

    lecture = store.get_lecture(lecture_id)
    if not lecture:
        return None

    chunk_index = store.append_live_segment(lecture_id, text, start, end)

    chroma_service.add_chunks(
        lecture_id,
        [{"text": text, "start": start, "end": end}],
        start_index=chunk_index,
    )

    store.update_lecture(lecture_id, num_chunks=lecture["num_chunks"] + 1)
    return chunk_index


@router.post("/live/{lecture_id}/chunk", response_model=LiveChunkResponse)
async def add_live_chunk(lecture_id: str, payload: LiveChunkRequest):
    """Called by the frontend each time a speech segment finalizes (mic mode,
    already transcribed by the browser). Embeds and stores just that one
    chunk - the rest of the transcript is untouched."""
    lecture = store.get_lecture(lecture_id)
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")
    if lecture["status"] != "live":
        raise HTTPException(
            status_code=409, detail=f"Lecture is not live (status={lecture['status']})"
        )

    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty transcript chunk")

    try:
        chunk_index = _index_live_text(lecture_id, text, payload.start, payload.end)
    except OllamaError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    return LiveChunkResponse(
        lecture_id=lecture_id, chunk_index=chunk_index, status="indexed", text=text
    )


@router.post("/live/{lecture_id}/audio-chunk", response_model=LiveChunkResponse)
async def add_live_audio_chunk(
    lecture_id: str,
    start: float = Form(...),
    end: float = Form(...),
    file: UploadFile = File(...),
):
    """For screen/tab-audio capture (no built-in browser transcription
    available for that source): transcribes a short audio segment with the
    existing, already-cached Whisper model, then indexes the resulting text
    through the exact same helper the manual chunk endpoint uses above."""
    lecture = store.get_lecture(lecture_id)
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")
    if lecture["status"] != "live":
        raise HTTPException(
            status_code=409, detail=f"Lecture is not live (status={lecture['status']})"
        )

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty audio chunk")

    suffix = os.path.splitext(file.filename or "")[1] or ".webm"
    os.makedirs(settings.upload_dir, exist_ok=True)
    tmp_path = os.path.join(settings.upload_dir, f"{lecture_id}-live-{uuid.uuid4().hex}{suffix}")

    with open(tmp_path, "wb") as f:
        f.write(content)

    try:
        result = transcribe_audio(tmp_path)
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Transcription failed: {exc}")
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass

    text = result["full_text"].strip()
    if not text:
        # Silence, or no speech detected in this segment - not an error,
        # just nothing to index. Common for pauses in the audio.
        return LiveChunkResponse(lecture_id=lecture_id, chunk_index=-1, status="skipped", text=None)

    try:
        chunk_index = _index_live_text(lecture_id, text, start, end)
    except OllamaError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    return LiveChunkResponse(
        lecture_id=lecture_id, chunk_index=chunk_index, status="indexed", text=text
    )


@router.post("/live/{lecture_id}/stop", response_model=LectureStatus)
async def stop_live_lecture(lecture_id: str):
    lecture = store.get_lecture(lecture_id)
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")
    store.stop_live_lecture(lecture_id)
    lecture = store.get_lecture(lecture_id)
    return LectureStatus(
        lecture_id=lecture_id,
        status=lecture["status"],
        progress=lecture["progress"],
        error=lecture.get("error"),
        general_knowledge=lecture.get("general_knowledge", False),
        num_chunks=lecture["num_chunks"],
    )


@router.patch("/{lecture_id}/general-knowledge", response_model=LectureStatus)
async def toggle_general_knowledge(lecture_id: str, payload: GeneralKnowledgeRequest):
    lecture = store.get_lecture(lecture_id)
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")
    store.set_general_knowledge(lecture_id, payload.enabled)
    lecture = store.get_lecture(lecture_id)
    return LectureStatus(
        lecture_id=lecture_id,
        status=lecture["status"],
        progress=lecture["progress"],
        error=lecture.get("error"),
        general_knowledge=lecture["general_knowledge"],
        num_chunks=lecture["num_chunks"],
    )


@router.get("/{lecture_id}/status", response_model=LectureStatus)
async def get_status(lecture_id: str):
    lecture = store.get_lecture(lecture_id)
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")
    return LectureStatus(
        lecture_id=lecture_id,
        status=lecture["status"],
        progress=lecture["progress"],
        error=lecture.get("error"),
        general_knowledge=lecture.get("general_knowledge", False),
        num_chunks=lecture["num_chunks"],
    )


@router.get("/{lecture_id}/transcript", response_model=TranscriptResponse)
async def get_transcript(lecture_id: str):
    lecture = store.get_lecture(lecture_id)
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")
    if lecture["status"] not in ("ready", "live", "completed"):
        raise HTTPException(
            status_code=409, detail=f"Transcript not ready yet (status={lecture['status']})"
        )

    segments = [TranscriptSegment(**s) for s in lecture["segments"]]
    return TranscriptResponse(
        lecture_id=lecture_id,
        full_text=lecture["full_text"],
        segments=segments,
        num_chunks=lecture["num_chunks"],
    )


@router.get("", response_model=List[LectureSummary])
async def list_lectures():
    lectures = store.list_lectures()
    return [
        LectureSummary(
            lecture_id=l["lecture_id"],
            title=l["title"],
            status=l["status"],
            mode=l.get("mode", "upload"),
            created_at=l["created_at"],
            num_chunks=l["num_chunks"],
        )
        for l in lectures
    ]


@router.delete("/{lecture_id}")
async def delete_lecture(lecture_id: str):
    lecture = store.get_lecture(lecture_id)
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")
    chroma_service.delete_lecture(lecture_id)
    store.update_lecture(lecture_id, status="deleted")
    return {"message": "Lecture deleted"}
