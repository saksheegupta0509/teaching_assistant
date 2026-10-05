"use client";

import Link from "next/link";
import StatusBadge from "./StatusBadge";
import type { LectureSummary } from "@/lib/api";

export default function LectureList({
  lectures,
  activeLectureId,
  onSelect,
}: {
  lectures: LectureSummary[];
  activeLectureId: string | null;
  onSelect: (id: string) => void;
}) {
  if (lectures.length === 0) {
    return (
      <p className="text-sm text-ink/40 border border-dashed border-chalk rounded-lg p-6 text-center">
        No lectures uploaded yet. Upload one to get started.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {lectures.map((l) => (
        <li key={l.lecture_id}>
          <button
            onClick={() => onSelect(l.lecture_id)}
            className={`w-full text-left border rounded-lg px-4 py-3 transition-colors ${
              activeLectureId === l.lecture_id
                ? "border-accent bg-accent/5"
                : "border-chalk bg-white/60 hover:border-accent/50"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-ink font-medium truncate">{l.title}</span>
              <StatusBadge status={l.status} />
            </div>
            <div className="flex items-center gap-3 mt-1.5 text-xs text-ink/40 font-mono">
              <span>{l.num_chunks} chunks</span>
              <span>&middot;</span>
              <span>{new Date(l.created_at).toLocaleString()}</span>
            </div>
          </button>
          {l.status === "ready" && (
            <Link
              href={`/classroom/${l.lecture_id}`}
              className="text-xs text-accent-dark ml-1 mt-1 inline-block hover:underline"
            >
              Open in classroom &rarr;
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
