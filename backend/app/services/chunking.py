"""
Splits a lecture transcript into overlapping text chunks suitable for
embedding + retrieval. Chunking is done on whisper segments so that each
chunk keeps its (start, end) timestamp range for citation purposes.
"""
from typing import List, Dict, Any


def chunk_segments(
    segments: List[Dict[str, Any]],
    chunk_size_chars: int = 800,
    overlap_chars: int = 150,
) -> List[Dict[str, Any]]:
    """
    Groups whisper segments into chunks of roughly `chunk_size_chars`
    characters, preserving start/end timestamps. Produces overlapping
    chunks so context isn't lost at boundaries.

    Returns a list of dicts: {text, start, end}
    """
    if not segments:
        return []

    chunks: List[Dict[str, Any]] = []
    current_text = ""
    current_start = segments[0]["start"]
    current_end = segments[0]["end"]

    for seg in segments:
        seg_text = seg["text"].strip()
        if not seg_text:
            continue

        candidate = f"{current_text} {seg_text}".strip()

        if len(candidate) > chunk_size_chars and current_text:
            chunks.append(
                {
                    "text": current_text.strip(),
                    "start": current_start,
                    "end": current_end,
                }
            )
            # start new chunk with overlap: keep tail of previous text
            overlap_text = current_text[-overlap_chars:] if overlap_chars else ""
            current_text = f"{overlap_text} {seg_text}".strip()
            current_start = seg["start"]
            current_end = seg["end"]
        else:
            current_text = candidate
            current_end = seg["end"]

    if current_text.strip():
        chunks.append(
            {
                "text": current_text.strip(),
                "start": current_start,
                "end": current_end,
            }
        )

    return chunks
