import type { SourceChunk } from "@/lib/api";

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function SourceChunks({ sources }: { sources: SourceChunk[] }) {
  if (!sources || sources.length === 0) return null;

  const rangeLabel =
    sources.length === 1
      ? `${formatTime(sources[0].start)} \u2013 ${formatTime(sources[0].end)}`
      : `${formatTime(sources[0].start)} \u2013 ${formatTime(sources[sources.length - 1].end)}`;

  return (
    <details className="mt-2 group">
      <summary className="cursor-pointer text-xs text-accent-dark font-mono select-none inline-flex items-center gap-1">
        <span className="group-open:rotate-90 transition-transform inline-block">&rsaquo;</span>
        Source: {rangeLabel}
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        {sources.map((s) => (
          <div
            key={s.chunk_id}
            className="text-xs bg-chalk/60 border border-chalk rounded-md p-3 text-ink/70 leading-relaxed"
          >
            <div className="flex items-center justify-between mb-1 font-mono text-accent-dark">
              <span>
                {formatTime(s.start)} &ndash; {formatTime(s.end)}
              </span>
              <span>relevance {Math.round(s.relevance_score * 100)}%</span>
            </div>
            <p>&ldquo;{s.text}&rdquo;</p>
          </div>
        ))}
      </div>
    </details>
  );
}
