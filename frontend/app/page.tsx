import Link from "next/link";

function WaveToText() {
  // Signature element: a soundwave that resolves into transcript lines,
  // visualizing "lecture audio becomes searchable text".
  const bars = [8, 20, 12, 28, 16, 32, 10, 24, 14, 30, 9, 18];
  return (
    <div className="flex items-center gap-6">
      <div className="flex items-end gap-[3px] h-9">
        {bars.map((h, i) => (
          <span
            key={i}
            className="w-[3px] rounded-full bg-accent/70"
            style={{ height: `${h}px` }}
          />
        ))}
      </div>
      <span className="font-mono text-accent-dark/60 text-sm">&#8594;</span>
      <div className="flex flex-col gap-1.5">
        <span className="h-[3px] w-24 rounded-full bg-ink/70" />
        <span className="h-[3px] w-16 rounded-full bg-ink/50" />
        <span className="h-[3px] w-20 rounded-full bg-ink/30" />
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col">
      <header className="border-b border-chalk px-6 md:px-10 py-5 flex items-center justify-between">
        <span className="font-display text-lg tracking-tight text-ink">Lecture Hall AI</span>
        <span className="font-mono text-xs text-ink/50 uppercase tracking-widest">MVP</span>
      </header>

      <section className="flex-1 px-6 md:px-10 py-16 md:py-24 max-w-5xl mx-auto w-full">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent-dark mb-6">
          Real-time transcript &middot; Grounded answers only
        </p>
        <h1 className="font-display text-4xl md:text-6xl leading-[1.05] text-ink mb-8 max-w-3xl">
          An assistant that only says what the lecture actually said.
        </h1>
        <p className="text-ink/70 text-lg max-w-xl mb-10 leading-relaxed">
          Start a live lecture and speak &mdash; the transcript is captured and indexed
          as you go, so students can ask questions that get answered strictly from what
          was taught &mdash; with the exact lecture timestamp cited every time.
        </p>

        <div className="mb-14">
          <WaveToText />
        </div>

        <div className="grid sm:grid-cols-2 gap-5 max-w-2xl">
          <Link
            href="/teacher"
            className="group border border-chalk bg-white/60 rounded-lg p-6 shadow-card hover:border-accent transition-colors"
          >
            <span className="font-mono text-xs uppercase tracking-widest text-accent-dark">
              For teachers
            </span>
            <h2 className="font-display text-2xl text-ink mt-2 mb-2">Start a lecture</h2>
            <p className="text-ink/60 text-sm leading-relaxed">
              Go live and speak, or upload a recording &mdash; either way, watch the
              transcript get indexed in real time.
            </p>
            <span className="inline-block mt-4 text-accent-dark text-sm group-hover:translate-x-1 transition-transform">
              Open dashboard &rarr;
            </span>
          </Link>

          <Link
            href="/classroom"
            className="group border border-chalk bg-white/60 rounded-lg p-6 shadow-card hover:border-accent transition-colors"
          >
            <span className="font-mono text-xs uppercase tracking-widest text-accent-dark">
              For students
            </span>
            <h2 className="font-display text-2xl text-ink mt-2 mb-2">Ask a question</h2>
            <p className="text-ink/60 text-sm leading-relaxed">
              Chat with the assistant about a lecture and see exactly which part of the
              transcript backs each answer.
            </p>
            <span className="inline-block mt-4 text-accent-dark text-sm group-hover:translate-x-1 transition-transform">
              Open classroom &rarr;
            </span>
          </Link>
        </div>
      </section>

      <footer className="px-6 md:px-10 py-6 border-t border-chalk text-xs text-ink/40 font-mono">
        Web Speech API &middot; Whisper &middot; ChromaDB &middot; Ollama &middot; FastAPI &middot; Next.js
      </footer>
    </main>
  );
}
