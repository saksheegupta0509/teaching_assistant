"use client";

import { useEffect, useState } from "react";
import { api, TranscriptResponse } from "@/lib/api";

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function TranscriptPanel({ lectureId }: { lectureId: string }) {
  const [transcript, setTranscript] = useState<TranscriptResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTranscript(null);
    setError(null);
    api
      .getTranscript(lectureId)
      .then(setTranscript)
      .catch((e) => setError(e.message));
  }, [lectureId]);

  if (error) {
    return <p className="text-sm text-ink/40 italic">Transcript not ready yet ({error}).</p>;
  }
  if (!transcript) {
    return <p className="text-sm text-ink/40">Loading transcript\u2026</p>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-lg text-ink">Live transcript</h3>
        <span className="text-xs font-mono text-ink/40">{transcript.num_chunks} chunks indexed</span>
      </div>
      <div className="max-h-80 overflow-y-auto scrollbar-thin flex flex-col gap-2 pr-1">
        {transcript.segments.map((seg, i) => (
          <div key={i} className="flex gap-3 text-sm">
            <span className="font-mono text-xs text-accent-dark/60 shrink-0 pt-0.5">
              {formatTime(seg.start)}
            </span>
            <p className="text-ink/75 leading-relaxed">{seg.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
