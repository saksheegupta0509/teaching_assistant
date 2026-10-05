const STYLES: Record<string, string> = {
  processing: "bg-chalk text-ink/60",
  transcribing: "bg-accent/15 text-accent-dark",
  chunking: "bg-accent/15 text-accent-dark",
  ready: "bg-accent text-white",
  live: "bg-warn/15 text-warn",
  completed: "bg-accent/15 text-accent-dark",
  failed: "bg-warn/15 text-warn",
  deleted: "bg-chalk text-ink/40",
};

const LABELS: Record<string, string> = {
  processing: "Queued",
  transcribing: "Transcribing",
  chunking: "Indexing",
  ready: "Ready",
  live: "Live",
  completed: "Completed",
  failed: "Failed",
  deleted: "Deleted",
};

export default function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
        STYLES[status] || "bg-chalk text-ink/60"
      }`}
    >
      {(status === "transcribing" || status === "chunking" || status === "processing" || status === "live") && (
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
      )}
      {LABELS[status] || status}
    </span>
  );
}
