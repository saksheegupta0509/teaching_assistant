# Lecture Hall AI — AI Teaching Assistant (MVP)

A teacher starts a **live lecture**, speaks, and the transcript is captured and
indexed sentence-by-sentence in real time. Students ask questions in a chat
interface and get answers grounded **strictly in what the teacher has actually
said so far** — with the exact lecture timestamp cited. If the lecture hasn't
covered it, the assistant says so, unless the teacher has turned on the
"Allow General Knowledge" setting and the student opts in.

Runs entirely on **Ollama** (local LLM + embeddings) — no OpenAI key, no data
leaving the machine.

---

## Architecture (whiteboard version)

```
Teacher speaks
      │
      ▼
Browser: Web Speech API → live transcript text
      │
      ▼
FastAPI: /api/lecture/live/{id}/chunk  (one finalized sentence at a time)
      │
      ▼
Ollama embeddings (nomic-embed-text)
      │
      ▼
ChromaDB  (chunk stored, tagged with this lecture_id)
      │
      ▼
Student asks a question
      │
      ▼
ChromaDB similarity search — scoped to lecture_id, top-k = 4
      │
      ▼
Retrieved lecture chunks → Ollama chat model (llama3.1)
      │
      ▼
Grounded answer + confidence + source timestamp
      │
      ▼
(not covered? → General Knowledge ON/OFF logic, see below)
```

This is the same "Speech-to-Text → Chunking → Embeddings → ChromaDB →
Similarity Search → LLM → Answer" pipeline as before — only the STT source
(live mic vs. uploaded file) and the AI provider (Ollama vs. OpenAI) changed.

---

## What changed in this upgrade

### Files created

| File | Purpose |
|------|---------|
| `backend/app/services/ollama_service.py` | Replaces `openai_service.py`. Calls a local Ollama server for grounded RAG answers and general-knowledge answers. Raises a clear `OllamaError` if Ollama is down or the model isn't pulled. |
| `frontend/components/LiveLecture.tsx` | The whole live-lecture teacher UI: Start/Stop, mic capture via the Web Speech API, live transcript display, General Knowledge toggle. |
| `frontend/lib/speech.d.ts` | Ambient TypeScript types for the browser's Web Speech API (not in TS's default DOM types). |

### Files removed

| File | Reason |
|------|--------|
| `backend/app/services/openai_service.py` | Replaced by `ollama_service.py`. |

### Files modified

| File | What changed |
|------|--------------|
| `backend/app/config.py` | `openai_*` settings → `ollama_base_url`, `ollama_chat_model`, `ollama_embedding_model`. No API key setting. |
| `backend/app/services/chroma_service.py` | `OpenAIEmbeddingFunction` → `embedding_functions.OllamaEmbeddingFunction`. `add_chunks()` now takes a `start_index` so live single-chunk calls don't overwrite each other in the vector store. Connectivity failures now raise a clear `OllamaError` instead of an opaque exception. |
| `backend/app/services/store.py` | Added `create_live_lecture()`, `append_live_segment()`, `stop_live_lecture()`, `set_general_knowledge()`. Lecture records now carry `mode` ("upload"/"live"), `general_knowledge` (bool), `next_chunk_index`. |
| `backend/app/models/schemas.py` | Added `LiveLectureStartRequest`, `LiveChunkRequest/Response`, `GeneralKnowledgeRequest`. `SourceChunk` now includes `start`/`end` timestamps (previously only relevance score). `ChatQuestionRequest` gained `confirm_general_knowledge`; `ChatAnswerResponse` gained `needs_confirmation` and `used_general_knowledge`. |
| `backend/app/routers/lecture.py` | Added `POST /live/start`, `POST /live/{id}/chunk`, `POST /live/{id}/stop`, `PATCH /{id}/general-knowledge`. Existing upload endpoints (`/upload`, `/{id}/status`, `/{id}/transcript`, list, delete) are untouched, just extended to also report `general_knowledge` and `mode`. |
| `backend/app/routers/chat.py` | Swapped `openai_service` for `ollama_service`. Same `/api/chat/ask` endpoint now implements the whole General Knowledge ON/OFF/confirm flow (see below) — no new endpoint needed. Added a friendly message for "question asked before enough lecture content exists". |
| `backend/requirements.txt` | Removed `openai`, `sqlalchemy`, `tenacity`; added `httpx` (used for direct Ollama HTTP calls). Kept `chromadb`, `faster-whisper`, FastAPI stack as-is. |
| `backend/.env.example` | `OPENAI_*` → `OLLAMA_BASE_URL` / `OLLAMA_CHAT_MODEL` / `OLLAMA_EMBEDDING_MODEL`. |
| `frontend/lib/api.ts` | Added `startLiveLecture`, `sendLiveChunk`, `stopLiveLecture`, `setGeneralKnowledge`; `askQuestion` gained a `confirmGeneralKnowledge` param. Types updated to match new backend fields. |
| `frontend/app/teacher/page.tsx` | `<LiveLecture />` is now the primary flow at the top of the page. The old upload flow (`UploadCard` + `LectureList` + `TranscriptPanel`) is preserved, unchanged, inside a collapsed "Or upload a recorded lecture instead" section. |
| `frontend/app/classroom/page.tsx` | Lecture picker now also lists `live` and `completed` lectures, not just uploaded `ready` ones. |
| `frontend/app/classroom/[lectureId]/page.tsx` | Handles `needs_confirmation` — shows Yes/No buttons under the "would you like general knowledge?" prompt, and resends the same question with `confirm_general_knowledge: true` if the student clicks Yes. |
| `frontend/components/MessageBubble.tsx` | Added the Yes/No confirmation buttons and a "general knowledge (not from lecture)" tag. |
| `frontend/components/SourceChunks.tsx` | Now shows `Source: 17:12 – 17:37` (lecture timestamp) instead of only a relevance percentage. |
| `frontend/components/StatusBadge.tsx` | Added styles/labels for the new `live` and `completed` statuses. |
| `frontend/app/page.tsx` | Landing page copy updated to describe the live-lecture flow; footer now lists Ollama instead of OpenAI. |

---

## How the two features work

### Live lecture pipeline

1. Teacher clicks **Start Live Lecture** → `POST /api/lecture/live/start` creates
   a lecture record with `status="live"` and a fresh `lecture_id`.
2. The browser's **Web Speech API** (`webkitSpeechRecognition`) listens
   continuously. Each time it finalizes a sentence, the frontend sends it to
   `POST /api/lecture/live/{id}/chunk` with an approximate start/end timestamp
   (measured client-side from when the lecture started).
3. The backend embeds *only that one chunk* via Ollama and upserts it into
   ChromaDB, tagged with `lecture_id` and an incrementing `chunk_index` — the
   rest of the transcript is never re-processed.
4. Teacher clicks **Stop Lecture** → `POST /api/lecture/live/{id}/stop` marks
   the lecture `completed`; no more chunks are accepted.

**Why the Web Speech API instead of streaming audio to Whisper on the
backend:** running Whisper against a continuous audio stream would need audio
buffering, voice-activity detection, and a websocket audio pipe — a lot of
moving parts for an interview project. The browser already does continuous
speech recognition natively, so this keeps the "live STT" step to a single,
easy-to-explain client-side API call. The trade-off: it only works in Chrome
and Edge (not Firefox/Safari), and timestamps are approximate (see
Limitations below). The existing Whisper-based upload flow still uses real
Whisper, unchanged, for anyone who wants exact server-side transcription.

### General Knowledge ON / OFF

Handled entirely inside the existing `POST /api/chat/ask` endpoint — no extra
endpoint, to keep the API surface small:

1. Always try a grounded answer from the current lecture first (RAG).
2. If the lecture doesn't cover it:
   - **OFF** → return `"This topic has not been covered in the lecture yet."`
   - **ON**, not yet confirmed → return `needs_confirmation: true` with the
     prompt `"I couldn't find this in the lecture. Would you like me to
     answer using general knowledge?"`. The frontend shows Yes/No buttons.
   - **ON**, confirmed (`confirm_general_knowledge: true` on the resend) →
     call Ollama with no lecture context and return that answer, flagged
     `used_general_knowledge: true`.
3. If the student clicks **No**, nothing is sent to the backend — the
   frontend just shows a local "sticking to lecture content" message.

The toggle itself lives on the teacher's live-lecture panel and calls
`PATCH /api/lecture/{id}/general-knowledge`.

---

## Setup

### Prerequisites

- Python 3.10+
- Node.js 18+
- [Ollama](https://ollama.com) installed and running locally
- `ffmpeg` on your PATH (only needed for the optional upload/Whisper flow)
- **Chrome or Edge** for the teacher's live-lecture tab (Web Speech API)

### 1. Pull the Ollama models

```bash
ollama pull llama3.1          # chat / answer generation
ollama pull nomic-embed-text  # embeddings

ollama serve                  # if not already running
```

You can swap either model name in `.env` (`OLLAMA_CHAT_MODEL`,
`OLLAMA_EMBEDDING_MODEL`) for a smaller/larger one you have pulled.

### 2. Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate

pip install -r requirements.txt

cp .env.example .env          # defaults already point at localhost:11434

uvicorn app.main:app --reload --port 8000
```

API docs: `http://localhost:8000/docs`

### 3. Frontend

```bash
cd frontend
npm install

cp .env.local.example .env.local

npm run dev
```

Open `http://localhost:3000`.

### 4. Test the full live lecture flow

1. Go to `http://localhost:3000/teacher` (in Chrome or Edge).
2. Click **Start Live Lecture** and allow microphone access.
3. Speak a few sentences — watch them appear under "Live transcript" within
   a second or two of finishing each sentence.
4. In another tab/device, go to `/classroom`, pick the live lecture, and ask
   a question about something you just said. You'll get an answer with a
   cited timestamp.
5. Ask something unrelated → **General Knowledge OFF**: you'll get *"This
   topic has not been covered in the lecture yet."*
6. On the teacher tab, flip **Allow General Knowledge** to ON. Ask the same
   unrelated question again → you'll be asked whether to use general
   knowledge; click **Yes** to get an answer, or **No** to decline it.
7. Click **Stop Lecture** on the teacher tab.

---

## Environment variables

### `backend/.env`

| Variable | Default | Purpose |
|----------|---------|---------|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Where Ollama is running |
| `OLLAMA_CHAT_MODEL` | `llama3.1` | Model used for answer generation |
| `OLLAMA_EMBEDDING_MODEL` | `nomic-embed-text` | Model used to embed transcript chunks + questions |
| `CHROMA_PERSIST_DIR` | `./chroma_db` | Where ChromaDB stores its index on disk |
| `CHROMA_COLLECTION_NAME` | `lecture_chunks` | Collection name |
| `RAG_TOP_K` | `4` | Chunks retrieved per question |
| `RAG_MIN_RELEVANCE` | `0.25` | Minimum cosine-similarity to keep a retrieved chunk |
| `WHISPER_MODEL_SIZE` / `WHISPER_DEVICE` / `WHISPER_COMPUTE_TYPE` | `base` / `cpu` / `int8` | Only used by the optional upload flow |
| `FRONTEND_ORIGIN` | `http://localhost:3000` | Allowed CORS origin |

### `frontend/.env.local`

| Variable | Default |
|----------|---------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` |

---

## Error handling

| Situation | What happens |
|-----------|---------------|
| Microphone permission denied | Live-lecture panel shows a plain-language error, stops trying to listen |
| No microphone found | Same, distinct message |
| Ollama not running | Any endpoint that needs it (chunk indexing, asking a question) returns `503` with *"Can't reach Ollama. Make sure it's running (`ollama serve`)."* |
| Ollama model not pulled | `503` with *"Model 'llama3.1' isn't available. Run `ollama pull llama3.1`."* |
| ChromaDB/embedding failure mid-request | Chunk is kept in the visible transcript but flagged as not indexed; a small warning shows on the teacher panel |
| Question asked before any chunks are indexed | Friendly *"lecture just started, try again in a moment"* message, no LLM call wasted |
| Browser doesn't support Web Speech API | Clear message telling the teacher to use Chrome or Edge |

---

## Known limitations

- **Timestamps are approximate.** The Web Speech API doesn't expose
  word-level timing, so each chunk's start/end is measured client-side from
  when the previous chunk ended to when the current one finalized — not the
  lecture audio's true timing.
- **Chrome/Edge only** for the live-lecture teacher view, since Web Speech
  Recognition isn't implemented in Firefox or Safari.
- **In-memory lecture/chat store** (unchanged from before) — restarting the
  backend loses lecture metadata and chat history, though the ChromaDB index
  itself persists to disk.
- **Single teacher stream at a time per browser tab** — this MVP doesn't
  handle multiple simultaneous live lectures from the same browser session,
  though multiple *different* lectures (by `lecture_id`) are safely isolated
  in ChromaDB.
- If a live chunk fails to embed (e.g. Ollama briefly down), it stays visible
  in the transcript but isn't searchable until the teacher notices the
  warning — there's no automatic retry queue, by design, to keep this simple.
