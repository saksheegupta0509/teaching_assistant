"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, LectureSummary, LectureStatus } from "@/lib/api";
import LiveLecture from "@/components/LiveLecture";
import UploadCard from "@/components/UploadCard";
import LectureList from "@/components/LectureList";
import TranscriptPanel from "@/components/TranscriptPanel";
import StatusBadge from "@/components/StatusBadge";

export default function TeacherDashboard() {
  const [lectures, setLectures] = useState<LectureSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeStatus, setActiveStatus] = useState<LectureStatus | null>(null);

  const refreshLectures = useCallback(() => {
    api.listLectures().then(setLectures).catch(() => {});
  }, []);

  useEffect(() => {
    refreshLectures();
    const interval = setInterval(refreshLectures, 4000);
    return () => clearInterval(interval);
  }, [refreshLectures]);

  // Poll status for the active uploaded lecture while it's processing
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;

    async function poll() {
      try {
        const status = await api.getLectureStatus(activeId as string);
        if (!cancelled) setActiveStatus(status);
        if (
          !cancelled &&
          (status.status === "transcribing" || status.status === "chunking" || status.status === "processing")
        ) {
          setTimeout(poll, 2500);
        } else {
          refreshLectures();
        }
      } catch {
        // lecture may not exist yet
      }
    }
    poll();
    return () => {
      cancelled = true;
    };
  }, [activeId, refreshLectures]);

  return (
    <main className="min-h-screen">
      <header className="border-b border-chalk px-6 md:px-10 py-5 flex items-center justify-between">
        <Link href="/" className="font-display text-lg text-ink">
          Lecture Hall AI
        </Link>
        <span className="font-mono text-xs text-ink/50 uppercase tracking-widest">
          Teacher dashboard
        </span>
      </header>

      <section className="px-6 md:px-10 py-10 max-w-3xl mx-auto flex flex-col gap-8">
        <div>
          <h1 className="font-display text-3xl text-ink mb-1">AI Teaching Assistant</h1>
          <p className="text-sm text-ink/50">
            Start a live lecture and students can ask questions about it as you speak.
          </p>
        </div>

        <LiveLecture />

        <details className="group">
          <summary className="cursor-pointer text-sm text-ink/50 hover:text-ink font-mono select-none">
            <span className="group-open:rotate-90 inline-block transition-transform mr-1">&rsaquo;</span>
            Or upload a recorded lecture instead
          </summary>

          <div className="mt-5 grid sm:grid-cols-[300px_1fr] gap-6">
            <div className="flex flex-col gap-6">
              <UploadCard
                onUploaded={(id) => {
                  setActiveId(id);
                  refreshLectures();
                }}
              />
              <div>
                <h3 className="font-mono text-xs uppercase tracking-widest text-ink/40 mb-3">
                  Uploaded lectures
                </h3>
                <LectureList lectures={lectures} activeLectureId={activeId} onSelect={setActiveId} />
              </div>
            </div>

            <div className="border border-chalk bg-white/60 rounded-lg p-6 shadow-card min-h-[300px]">
              {!activeId && (
                <p className="text-sm text-ink/40 text-center pt-16">
                  Select or upload a lecture to see its status and transcript.
                </p>
              )}

              {activeId && activeStatus && (
                <div>
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="font-display text-2xl text-ink">Lecture status</h2>
                    <StatusBadge status={activeStatus.status} />
                  </div>

                  {activeStatus.status !== "ready" && activeStatus.status !== "failed" && (
                    <div className="mb-8">
                      <div className="h-2 bg-chalk rounded-full overflow-hidden">
                        <div
                          className="h-full bg-accent transition-all duration-500"
                          style={{ width: `${activeStatus.progress}%` }}
                        />
                      </div>
                      <p className="text-xs text-ink/40 mt-2 font-mono">
                        {activeStatus.progress}% &middot; this can take a minute depending on lecture length
                      </p>
                    </div>
                  )}

                  {activeStatus.status === "failed" && (
                    <p className="text-sm text-warn bg-warn/10 rounded-md p-4">
                      Processing failed: {activeStatus.error}
                    </p>
                  )}

                  {activeStatus.status === "ready" && (
                    <>
                      <div className="mb-6">
                        <Link
                          href={`/classroom/${activeId}`}
                          className="inline-block px-4 py-2 rounded-md bg-ink text-paper text-sm font-medium hover:bg-accent-dark transition-colors"
                        >
                          Open student classroom &rarr;
                        </Link>
                      </div>
                      <TranscriptPanel lectureId={activeId} />
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </details>
      </section>
    </main>
  );
}
