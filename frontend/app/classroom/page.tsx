"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, LectureSummary } from "@/lib/api";
import StatusBadge from "@/components/StatusBadge";

export default function ClassroomIndex() {
  const [lectures, setLectures] = useState<LectureSummary[]>([]);

  useEffect(() => {
    api.listLectures().then(setLectures).catch(() => {});
  }, []);

  const askable = lectures.filter((l) => l.status === "ready" || l.status === "live" || l.status === "completed");

  return (
    <main className="min-h-screen">
      <header className="border-b border-chalk px-6 md:px-10 py-5 flex items-center justify-between">
        <Link href="/" className="font-display text-lg text-ink">
          Lecture Hall AI
        </Link>
        <span className="font-mono text-xs text-ink/50 uppercase tracking-widest">Classroom</span>
      </header>

      <section className="px-6 md:px-10 py-14 max-w-2xl mx-auto">
        <h1 className="font-display text-3xl text-ink mb-2">Choose a lecture</h1>
        <p className="text-ink/60 mb-8">Pick a lecture that's ready to ask questions about.</p>

        {askable.length === 0 && (
          <p className="text-sm text-ink/40 border border-dashed border-chalk rounded-lg p-8 text-center">
            No lectures are ready yet. Ask your teacher to start or upload one, or check the{" "}
            <Link href="/teacher" className="text-accent-dark hover:underline">
              teacher dashboard
            </Link>
            .
          </p>
        )}

        <ul className="flex flex-col gap-3">
          {askable.map((l) => (
            <li key={l.lecture_id}>
              <Link
                href={`/classroom/${l.lecture_id}`}
                className="flex items-center justify-between border border-chalk bg-white/60 rounded-lg px-5 py-4 shadow-card hover:border-accent transition-colors"
              >
                <div>
                  <p className="text-ink font-medium">{l.title}</p>
                  <p className="text-xs text-ink/40 font-mono mt-1">{l.num_chunks} chunks indexed</p>
                </div>
                <StatusBadge status={l.status} />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
