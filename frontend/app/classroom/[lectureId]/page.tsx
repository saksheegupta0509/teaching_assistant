"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import MessageBubble, { DisplayMessage } from "@/components/MessageBubble";

const SESSION_KEY = "lecture-hall-session-id";

function getSessionId() {
  if (typeof window === "undefined") return "default";
  let id = window.localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = `student-${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

export default function ClassroomChat() {
  const params = useParams<{ lectureId: string }>();
  const lectureId = params.lectureId;

  const [sessionId, setSessionId] = useState("default");
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSessionId(getSessionId());
  }, []);

  useEffect(() => {
    if (!lectureId || sessionId === "default") return;
    api
      .getChatHistory(lectureId, sessionId)
      .then((res) =>
        setMessages(
          res.messages.map((m) => ({
            role: m.role,
            content: m.content,
            timestamp: m.timestamp,
            sources: m.sources,
            confidence: m.confidence,
          }))
        )
      )
      .catch(() => {});
  }, [lectureId, sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  async function handleSend() {
    const question = input.trim();
    if (!question || sending) return;

    setInput("");
    setError(null);
    setMessages((prev) => [
      ...prev,
      { role: "student", content: question, timestamp: new Date().toISOString() },
    ]);
    setSending(true);

    try {
      const res = await api.askQuestion(lectureId, question, sessionId, false);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: res.answer,
          timestamp: res.timestamp,
          sources: res.sources,
          confidence: res.confidence,
          covered: res.covered,
          needsConfirmation: res.needs_confirmation,
          usedGeneralKnowledge: res.used_general_knowledge,
          relatedQuestion: question,
        },
      ]);
    } catch (e: any) {
      setError(e.message || "Something went wrong asking that question.");
    } finally {
      setSending(false);
    }
  }

  async function handleConfirmGeneralKnowledge(index: number, confirmed: boolean) {
    const question = messages[index]?.relatedQuestion;
    if (!question) return;

    // Hide the Yes/No buttons on that message once answered.
    setMessages((prev) =>
      prev.map((m, i) => (i === index ? { ...m, needsConfirmation: false } : m))
    );

    if (!confirmed) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Okay, I'll stick to what's covered in the lecture.",
          timestamp: new Date().toISOString(),
        },
      ]);
      return;
    }

    setSending(true);
    setError(null);
    try {
      const res = await api.askQuestion(lectureId, question, sessionId, true);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: res.answer,
          timestamp: res.timestamp,
          sources: res.sources,
          confidence: res.confidence,
          covered: res.covered,
          usedGeneralKnowledge: res.used_general_knowledge,
        },
      ]);
    } catch (e: any) {
      setError(e.message || "Something went wrong getting that answer.");
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col">
      <header className="border-b border-chalk px-6 md:px-10 py-5 flex items-center justify-between">
        <Link href="/" className="font-display text-lg text-ink">
          Lecture Hall AI
        </Link>
        <Link href="/classroom" className="text-xs text-ink/50 hover:text-ink font-mono">
          &larr; change lecture
        </Link>
      </header>

      <section className="flex-1 flex flex-col max-w-3xl mx-auto w-full px-6 md:px-10 py-8">
        <div className="flex-1 flex flex-col gap-4 overflow-y-auto scrollbar-thin pr-1 mb-4 min-h-[50vh]">
          {messages.length === 0 && (
            <p className="text-sm text-ink/40 text-center pt-16">
              Ask anything about this lecture. Answers are grounded strictly in what was
              taught &mdash; if it wasn&apos;t covered, you&apos;ll be told directly.
            </p>
          )}
          {messages.map((m, i) => (
            <MessageBubble
              key={i}
              message={m}
              onConfirmGeneralKnowledge={
                m.needsConfirmation ? (confirmed) => handleConfirmGeneralKnowledge(i, confirmed) : undefined
              }
            />
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="bg-white border border-chalk rounded-xl rounded-bl-sm px-4 py-3 shadow-card">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-ink/30 animate-bounce [animation-delay:-0.3s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-ink/30 animate-bounce [animation-delay:-0.15s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-ink/30 animate-bounce" />
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {error && <p className="text-sm text-warn mb-3">{error}</p>}

        <div className="flex gap-2 sticky bottom-6">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Ask a question about this lecture\u2026"
            className="flex-1 px-4 py-3 rounded-lg border border-chalk bg-white text-sm focus:border-accent outline-none shadow-card"
          />
          <button
            onClick={handleSend}
            disabled={sending || !input.trim()}
            className="px-5 py-3 rounded-lg bg-ink text-paper text-sm font-medium disabled:opacity-40 hover:bg-accent-dark transition-colors"
          >
            Ask
          </button>
        </div>
      </section>
    </main>
  );
}
