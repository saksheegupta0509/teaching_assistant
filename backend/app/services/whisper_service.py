"""
Speech-to-text using faster-whisper (a fast CTranslate2 reimplementation
of OpenAI's Whisper). Model is loaded once and cached.

To use the original openai-whisper package instead, swap this module's
implementation - the public `transcribe_audio()` function signature is
what the rest of the app depends on.
"""
from functools import lru_cache
from typing import List, Dict, Any

from app.config import get_settings

settings = get_settings()


@lru_cache
def _get_model():
    # Imported lazily so the API can boot even if the model / ctranslate2
    # backend isn't installed yet (useful for frontend-only dev work).
    from faster_whisper import WhisperModel

    return WhisperModel(
        settings.whisper_model_size,
        device=settings.whisper_device,
        compute_type=settings.whisper_compute_type,
    )


def transcribe_audio(file_path: str) -> Dict[str, Any]:
    """
    Transcribes an audio/video file at `file_path`.

    Returns:
        {
            "full_text": str,
            "segments": [{"start": float, "end": float, "text": str}, ...],
            "language": str,
        }
    """
    model = _get_model()

    segments_iter, info = model.transcribe(file_path, beam_size=5, vad_filter=True)

    segments: List[Dict[str, Any]] = []
    full_text_parts: List[str] = []

    for seg in segments_iter:
        text = seg.text.strip()
        if not text:
            continue
        segments.append({"start": seg.start, "end": seg.end, "text": text})
        full_text_parts.append(text)

    return {
        "full_text": " ".join(full_text_parts),
        "segments": segments,
        "language": info.language,
    }
