"""
Calls a locally running Ollama server for:
  1. Grounded RAG answer generation (uses ONLY retrieved lecture chunks).
  2. Plain general-knowledge answers (used only when the teacher has turned
     "Allow General Knowledge" ON and the student has confirmed they want it).

No API key is required - Ollama runs locally at OLLAMA_BASE_URL.

Why Ollama instead of OpenAI: it runs entirely on the local machine, so the
lecture content and student questions never leave the server - useful for a
classroom setting and avoids any API cost or key management.
"""
import json
from typing import List, Dict, Any

import httpx

from app.config import get_settings

settings = get_settings()

NOT_COVERED_MESSAGE = "This topic has not been covered in the lecture yet."

GROUNDED_SYSTEM_PROMPT = """You are an AI Teaching Assistant answering student questions \
during a live lecture.

STRICT RULES:
1. Answer ONLY using the "LECTURE CONTEXT" provided below. Never use outside knowledge.
2. If the lecture context does not contain enough information to answer the question, \
set "covered" to false.
3. If the context partially covers it, answer only with what is supported and set \
"covered" to true, but lower your confidence score.
4. Never make up facts, numbers, or examples that are not in the lecture context.
5. Keep answers concise (2-5 sentences) and student-friendly.

Respond ONLY with a JSON object, no markdown fences, matching exactly this shape:
{"answer": string, "covered": boolean, "confidence": number between 0 and 1}
"""

GENERAL_SYSTEM_PROMPT = (
    "You are a helpful teaching assistant. The student's question was not covered "
    "in the lecture, but you have been given permission to answer using your own "
    "general knowledge. Keep the answer concise (2-5 sentences) and mention that "
    "this answer is not from the lecture."
)


class OllamaError(Exception):
    """Raised when Ollama can't be reached or the model isn't available."""


def _chat(messages: List[Dict[str, str]], json_mode: bool) -> str:
    payload: Dict[str, Any] = {
        "model": settings.ollama_chat_model,
        "messages": messages,
        "stream": False,
    }
    if json_mode:
        payload["format"] = "json"

    try:
        response = httpx.post(
            f"{settings.ollama_base_url}/api/chat", json=payload, timeout=60
        )
    except httpx.ConnectError as exc:
        raise OllamaError(
            "Can't reach Ollama. Make sure it's running (`ollama serve`)."
        ) from exc

    if response.status_code == 404:
        raise OllamaError(
            f"Model '{settings.ollama_chat_model}' isn't available. "
            f"Run `ollama pull {settings.ollama_chat_model}`."
        )
    if response.status_code >= 400:
        raise OllamaError(f"Ollama returned an error: {response.text[:200]}")

    data = response.json()
    return data["message"]["content"]


def generate_grounded_answer(
    question: str, retrieved_chunks: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Generates an answer to `question` using only `retrieved_chunks` as context.
    Returns: {"answer": str, "covered": bool, "confidence": float}
    Raises OllamaError if Ollama is unreachable or the model is missing.
    """
    if not retrieved_chunks:
        return {"answer": NOT_COVERED_MESSAGE, "covered": False, "confidence": 0.0}

    context_block = "\n\n".join(
        f"[Chunk {i+1} | {c['start']:.0f}s-{c['end']:.0f}s]\n{c['text']}"
        for i, c in enumerate(retrieved_chunks)
    )

    user_prompt = f"""LECTURE CONTEXT:
{context_block}

STUDENT QUESTION:
{question}
"""

    messages = [
        {"role": "system", "content": GROUNDED_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]

    raw = _chat(messages, json_mode=True)

    try:
        parsed = json.loads(raw)
        answer = parsed.get("answer", NOT_COVERED_MESSAGE)
        covered = bool(parsed.get("covered", False))
        confidence = float(parsed.get("confidence", 0.0))
        confidence = max(0.0, min(1.0, confidence))
        return {"answer": answer, "covered": covered, "confidence": confidence}
    except (json.JSONDecodeError, ValueError, TypeError):
        # Model didn't return valid JSON - fail safe instead of guessing.
        return {
            "answer": "Sorry, I had trouble forming an answer. Please try again.",
            "covered": False,
            "confidence": 0.0,
        }


def generate_general_answer(question: str) -> str:
    """
    Answers `question` using the model's general knowledge (no lecture context).
    Only called after the student explicitly opts in.
    """
    messages = [
        {"role": "system", "content": GENERAL_SYSTEM_PROMPT},
        {"role": "user", "content": question},
    ]
    raw = _chat(messages, json_mode=False)
    return raw.strip()
