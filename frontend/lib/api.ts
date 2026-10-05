/**
 * Thin fetch wrapper around the FastAPI backend. Keeps all endpoint
 * paths and response typing in one place.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface LectureSummary {
  lecture_id: string;
  title: string;
  status: string;
  mode: "upload" | "live";
  created_at: string;
  num_chunks: number;
}

export interface LectureStatus {
  lecture_id: string;
  status:
    | "processing"
    | "transcribing"
    | "chunking"
    | "ready"
    | "live"
    | "completed"
    | "failed"
    | "deleted";
  progress: number;
  error: string | null;
  general_knowledge: boolean;
  num_chunks: number;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptResponse {
  lecture_id: string;
  full_text: string;
  segments: TranscriptSegment[];
  num_chunks: number;
}

export interface SourceChunk {
  chunk_id: string;
  text: string;
  start: number;
  end: number;
  relevance_score: number;
}

export interface ChatAnswer {
  session_id: string;
  question: string;
  answer: string;
  confidence: number;
  covered: boolean;
  needs_confirmation: boolean;
  used_general_knowledge: boolean;
  sources: SourceChunk[];
  timestamp: string;
}

export interface ChatMessage {
  role: "student" | "assistant";
  content: string;
  timestamp: string;
  sources?: SourceChunk[] | null;
  confidence?: number | null;
}

export interface LiveChunkResult {
  lecture_id: string;
  chunk_index: number;
  status: "indexed" | "skipped";
  text: string | null;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(options?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...options?.headers,
    },
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      // ignore parse errors
    }
    throw new Error(detail);
  }

  return res.json() as Promise<T>;
}

export const api = {
  uploadLecture: (file: File, title?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (title) form.append("title", title);
    return request<{ lecture_id: string; filename: string; status: string; message: string }>(
      "/api/lecture/upload",
      { method: "POST", body: form }
    );
  },

  getLectureStatus: (lectureId: string) =>
    request<LectureStatus>(`/api/lecture/${lectureId}/status`),

  getTranscript: (lectureId: string) =>
    request<TranscriptResponse>(`/api/lecture/${lectureId}/transcript`),

  listLectures: () => request<LectureSummary[]>("/api/lecture"),

  deleteLecture: (lectureId: string) =>
    request<{ message: string }>(`/api/lecture/${lectureId}`, { method: "DELETE" }),

  askQuestion: (
    lectureId: string,
    question: string,
    sessionId = "default",
    confirmGeneralKnowledge = false
  ) =>
    request<ChatAnswer>("/api/chat/ask", {
      method: "POST",
      body: JSON.stringify({
        lecture_id: lectureId,
        question,
        session_id: sessionId,
        confirm_general_knowledge: confirmGeneralKnowledge,
      }),
    }),

  getChatHistory: (lectureId: string, sessionId = "default") =>
    request<{ lecture_id: string; session_id: string; messages: ChatMessage[] }>(
      `/api/chat/${lectureId}/history?session_id=${sessionId}`
    ),

  // --- Live lecture ---
  startLiveLecture: (title?: string) =>
    request<{ lecture_id: string; filename: string; status: string; message: string }>(
      "/api/lecture/live/start",
      { method: "POST", body: JSON.stringify({ title }) }
    ),

  sendLiveChunk: (lectureId: string, text: string, start: number, end: number) =>
    request<LiveChunkResult>(`/api/lecture/live/${lectureId}/chunk`, {
      method: "POST",
      body: JSON.stringify({ text, start, end }),
    }),

  // Screen/tab-audio path: uploads a short audio blob, backend transcribes
  // it with Whisper and indexes it through the same pipeline as sendLiveChunk.
  sendLiveAudioChunk: (lectureId: string, blob: Blob, start: number, end: number) => {
    const form = new FormData();
    form.append("file", blob, "chunk.webm");
    form.append("start", String(start));
    form.append("end", String(end));
    return request<LiveChunkResult>(`/api/lecture/live/${lectureId}/audio-chunk`, {
      method: "POST",
      body: form,
    });
  },

  stopLiveLecture: (lectureId: string) =>
    request<LectureStatus>(`/api/lecture/live/${lectureId}/stop`, { method: "POST" }),

  setGeneralKnowledge: (lectureId: string, enabled: boolean) =>
    request<LectureStatus>(`/api/lecture/${lectureId}/general-knowledge`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),
};
