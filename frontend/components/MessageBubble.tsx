import SourceChunks from "./SourceChunks";
import type { SourceChunk } from "@/lib/api";

export interface DisplayMessage {
  role: "student" | "assistant";
  content: string;
  timestamp: string;
  sources?: SourceChunk[] | null;
  confidence?: number | null;
  covered?: boolean;
  needsConfirmation?: boolean;
  usedGeneralKnowledge?: boolean;
  relatedQuestion?: string;
}

function StatusTag({
  confidence,
  covered,
  usedGeneralKnowledge,
}: {
  confidence: number;
  covered?: boolean;
  usedGeneralKnowledge?: boolean;
}) {
  if (usedGeneralKnowledge) {
    return <span className="text-xs font-mono text-ink/50">general knowledge (not from lecture)</span>;
  }
  const pct = Math.round(confidence * 100);
  const color =
    covered === false ? "text-warn" : pct >= 70 ? "text-accent-dark" : pct >= 40 ? "text-ink/50" : "text-warn";

  return (
    <span className={`text-xs font-mono ${color}`}>
      {covered === false ? "not covered" : `${pct}% confidence`}
    </span>
  );
}

export default function MessageBubble({
  message,
  onConfirmGeneralKnowledge,
}: {
  message: DisplayMessage;
  onConfirmGeneralKnowledge?: (confirmed: boolean) => void;
}) {
  const isStudent = message.role === "student";

  return (
    <div className={`flex ${isStudent ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] ${isStudent ? "items-end" : "items-start"} flex flex-col`}>
        <div
          className={`rounded-xl px-4 py-3 text-sm leading-relaxed ${
            isStudent
              ? "bg-ink text-paper rounded-br-sm"
              : "bg-white border border-chalk text-ink rounded-bl-sm shadow-card"
          }`}
        >
          {message.content}
        </div>

        {!isStudent && message.needsConfirmation && onConfirmGeneralKnowledge && (
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => onConfirmGeneralKnowledge(true)}
              className="px-3 py-1.5 rounded-md bg-ink text-paper text-xs font-medium hover:bg-accent-dark transition-colors"
            >
              Yes, use general knowledge
            </button>
            <button
              onClick={() => onConfirmGeneralKnowledge(false)}
              className="px-3 py-1.5 rounded-md border border-chalk text-ink/60 text-xs font-medium hover:bg-chalk/60 transition-colors"
            >
              No
            </button>
          </div>
        )}

        <div className="flex items-center gap-3 mt-1.5 px-1">
          <span className="text-[10px] text-ink/30 font-mono">
            {new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          {!isStudent && typeof message.confidence === "number" && !message.needsConfirmation && (
            <StatusTag
              confidence={message.confidence}
              covered={message.covered}
              usedGeneralKnowledge={message.usedGeneralKnowledge}
            />
          )}
        </div>

        {!isStudent && message.sources && <SourceChunks sources={message.sources} />}
      </div>
    </div>
  );
}
