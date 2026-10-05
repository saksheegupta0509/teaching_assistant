"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

interface LiveSegment {
  start: number;
  end: number;
  text: string;
}

type CaptureMode = "mic" | "tab";

// Each screen/tab-audio segment is recorded as one complete, independent
// MediaRecorder start->stop cycle (not a `timeslice` fragment) so every
// blob is guaranteed to be a valid, self-contained WebM file Whisper can
// decode. 7s keeps it within the 5-10s "sensible chunk duration" range -
// long enough to amortize Whisper's per-call overhead, short enough to
// still feel live.
const TAB_AUDIO_SEGMENT_MS = 7000;
// Skip near-empty recordings (e.g. a picker glitch) without bothering the backend.
const MIN_AUDIO_BLOB_BYTES = 2000;

function formatElapsed(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function getSpeechRecognitionCtor(): { new (): SpeechRecognition } | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export default function LiveLecture() {
  const [lectureId, setLectureId] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [captureMode, setCaptureMode] = useState<CaptureMode>("mic");
  const [activeCaptureMode, setActiveCaptureMode] = useState<CaptureMode | null>(null);
  const [segments, setSegments] = useState<LiveSegment[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [generalKnowledge, setGeneralKnowledge] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [indexingWarning, setIndexingWarning] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  // Mic (Web Speech API) path
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const restartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tab/screen-audio path
  const displayStreamRef = useRef<MediaStream | null>(null);
  const audioOnlyStreamRef = useRef<MediaStream | null>(null);
  const tabRecorderRef = useRef<MediaRecorder | null>(null);
  const tabSegmentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Shared
  const shouldListenRef = useRef(false);
  const fatalErrorRef = useRef(false);
  const lectureStartMsRef = useRef<number>(0);
  const segmentStartSecRef = useRef<number>(0);
  const lectureIdRef = useRef<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      if (shouldListenRef.current) {
        setElapsed((Date.now() - lectureStartMsRef.current) / 1000);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Stop listening cleanly if the component unmounts mid-lecture.
  useEffect(() => {
    return () => {
      shouldListenRef.current = false;
      fatalErrorRef.current = true;
      if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
      if (tabSegmentTimerRef.current) clearTimeout(tabSegmentTimerRef.current);
      recognitionRef.current?.stop();
      if (tabRecorderRef.current && tabRecorderRef.current.state !== "inactive") {
        tabRecorderRef.current.stop();
      }
      displayStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioOnlyStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // --- Shared: a finalized piece of transcript text arrived (from either
  // the mic path directly, or the backend after transcribing an audio blob) ---
  const addSegmentToTranscript = useCallback((start: number, end: number, text: string) => {
    setSegments((prev) => [...prev, { start, end, text }]);
  }, []);

  // ================= Microphone path (Web Speech API) =================

  const handleFinalTranscript = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !lectureIdRef.current) return;

      const end = (Date.now() - lectureStartMsRef.current) / 1000;
      const start = segmentStartSecRef.current;
      segmentStartSecRef.current = end;

      addSegmentToTranscript(start, end, trimmed);

      try {
        await api.sendLiveChunk(lectureIdRef.current, trimmed, start, end);
        setIndexingWarning(null);
      } catch (e: any) {
        // Keep showing the transcript even if indexing failed - just warn.
        setIndexingWarning(e.message || "Couldn't index the last chunk.");
      }
    },
    [addSegmentToTranscript]
  );

  function startRecognition() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setError(
        "Live transcription needs the Web Speech API, which is only available in Chrome or Edge."
      );
      return;
    }

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      // onend only ever restarts us when nothing fatal happened, so it's
      // safe to clear any leftover transient error (e.g. a previous
      // "network" hiccup) once a new session is actually up and listening.
      setError(null);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          handleFinalTranscript(result[0].transcript);
        }
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setError("Microphone permission denied. Please allow microphone access and try again.");
        fatalErrorRef.current = true;
        shouldListenRef.current = false;
        setIsLive(false);
      } else if (event.error === "audio-capture") {
        setError("No microphone was found. Please connect one and try again.");
        fatalErrorRef.current = true;
        shouldListenRef.current = false;
        setIsLive(false);
      } else if (event.error === "aborted") {
        // Fires whenever a session stops early - including our own restarts
        // below and the user clicking Stop. Not a real failure; onend will
        // decide whether to restart. Don't surface this to the teacher.
      } else if (event.error === "no-speech") {
        // Chrome stops after a pause with no speech - expected, restart via onend.
      } else {
        // Network hiccups etc. - show it, but keep listening.
        setError(`Speech recognition error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      if (!shouldListenRef.current || fatalErrorRef.current) return;

      // Restart with a fresh instance after a short delay. Reusing the same
      // (now-ended) recognition object, or calling start() again in the same
      // tick as onend, is what was causing an immediate "aborted" loop.
      restartTimeoutRef.current = setTimeout(() => {
        if (shouldListenRef.current && !fatalErrorRef.current) {
          startRecognition();
        }
      }, 300);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      // Only throws if a session is already active on this instance - a
      // brand-new instance can't hit this, so safe to ignore.
    }
  }

  async function requestMicPermission(): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser doesn't support microphone access.");
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // We only needed this to confirm/trigger the permission prompt and
      // catch errors early. Release it immediately - SpeechRecognition
      // opens its own mic stream internally, and leaving this one open
      // can make the two contend for the same device.
      stream.getTracks().forEach((track) => track.stop());
      return true;
    } catch (e: any) {
      if (e?.name === "NotAllowedError" || e?.name === "PermissionDeniedError") {
        setError("Microphone permission denied. Please allow microphone access and try again.");
      } else if (e?.name === "NotFoundError" || e?.name === "DevicesNotFoundError") {
        setError("No microphone was found. Please connect one and try again.");
      } else {
        setError("Couldn't access the microphone. Please check your browser and OS settings.");
      }
      return false;
    }
  }

  // ================= Screen/tab-audio path (getDisplayMedia + Whisper) =================

  function scheduleTabAudioSegment(audioStream: MediaStream) {
    if (!shouldListenRef.current) return;

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(audioStream, { mimeType: "audio/webm;codecs=opus" });
    } catch {
      recorder = new MediaRecorder(audioStream);
    }

    const blobs: Blob[] = [];
    const segmentStart = segmentStartSecRef.current;

    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) blobs.push(e.data);
    };

    recorder.onstop = () => {
      const segmentEnd = (Date.now() - lectureStartMsRef.current) / 1000;
      segmentStartSecRef.current = segmentEnd;

      const blob = new Blob(blobs, { type: "audio/webm" });

      // Don't block recording on the upload/transcription round trip - fire
      // it off in the background and immediately start the next segment
      // below, so the teacher's audio keeps being captured gaplessly.
      if (blob.size >= MIN_AUDIO_BLOB_BYTES && lectureIdRef.current) {
        api
          .sendLiveAudioChunk(lectureIdRef.current, blob, segmentStart, segmentEnd)
          .then((res) => {
            setIndexingWarning(null);
            if (res.status === "indexed" && res.text) {
              addSegmentToTranscript(segmentStart, segmentEnd, res.text);
            }
            // status === "skipped" means Whisper heard silence in this
            // window - normal during pauses, nothing to show or index.
          })
          .catch((e: any) => {
            setIndexingWarning(e.message || "Couldn't transcribe the last audio segment.");
          });
      }

      if (shouldListenRef.current) {
        scheduleTabAudioSegment(audioStream);
      }
    };

    tabRecorderRef.current = recorder;
    recorder.start();

    tabSegmentTimerRef.current = setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, TAB_AUDIO_SEGMENT_MS);
  }

  async function startTabAudioCapture(): Promise<boolean> {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError(
        "This browser doesn't support screen/tab audio capture. Try Chrome or Edge, or use the microphone instead."
      );
      return false;
    }

    let displayStream: MediaStream;
    try {
      displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true, // required by most browsers' implementation to allow audio capture at all
        audio: true,
      });
    } catch (e: any) {
      if (e?.name === "NotAllowedError") {
        setError("Screen/tab sharing was cancelled or denied.");
      } else {
        setError("Couldn't start screen/tab audio capture.");
      }
      return false;
    }

    const audioTracks = displayStream.getAudioTracks();
    if (audioTracks.length === 0) {
      displayStream.getTracks().forEach((t) => t.stop());
      setError(
        'No audio was shared. When picking a source, make sure to check "Share tab audio" ' +
          '(Chrome) or "Share system audio", or nothing will be transcribed.'
      );
      return false;
    }

    // We never display the video - stop it so we're only holding the audio track.
    displayStream.getVideoTracks().forEach((t) => t.stop());

    const audioOnlyStream = new MediaStream(audioTracks);
    displayStreamRef.current = displayStream;
    audioOnlyStreamRef.current = audioOnlyStream;

    // If the teacher clicks the browser's native "Stop sharing" bar, end the lecture cleanly.
    audioTracks[0].addEventListener("ended", () => {
      if (shouldListenRef.current) handleStop();
    });

    scheduleTabAudioSegment(audioOnlyStream);
    return true;
  }

  // ================= Start / stop (shared) =================

  async function handleStart() {
    setError(null);
    setStarting(true);

    if (captureMode === "mic") {
      if (!getSpeechRecognitionCtor()) {
        setError(
          "Live transcription needs the Web Speech API, which is only available in Chrome or Edge."
        );
        setStarting(false);
        return;
      }
      const micOk = await requestMicPermission();
      if (!micOk) {
        setStarting(false);
        return;
      }
    } else if (!navigator.mediaDevices?.getDisplayMedia) {
      setError(
        "This browser doesn't support screen/tab audio capture. Try Chrome or Edge, or use the microphone instead."
      );
      setStarting(false);
      return;
    }

    try {
      const res = await api.startLiveLecture();
      setLectureId(res.lecture_id);
      lectureIdRef.current = res.lecture_id;
      setSegments([]);
      setElapsed(0);
      lectureStartMsRef.current = Date.now();
      segmentStartSecRef.current = 0;
      fatalErrorRef.current = false;
      shouldListenRef.current = true;

      if (captureMode === "mic") {
        setActiveCaptureMode("mic");
        setIsLive(true);
        startRecognition();
      } else {
        const ok = await startTabAudioCapture();
        if (!ok) {
          shouldListenRef.current = false;
          // The lecture record already exists on the backend, but nothing
          // will be indexed until the teacher tries again - acceptable for
          // this MVP rather than adding rollback/delete complexity here.
          setStarting(false);
          return;
        }
        setActiveCaptureMode("tab");
        setIsLive(true);
      }
    } catch (e: any) {
      setError(e.message || "Couldn't start the lecture.");
    } finally {
      setStarting(false);
    }
  }

  async function handleStop() {
    shouldListenRef.current = false;
    fatalErrorRef.current = true; // prevents any pending restart/segment timer from firing

    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }
    recognitionRef.current?.stop();

    if (tabSegmentTimerRef.current) {
      clearTimeout(tabSegmentTimerRef.current);
      tabSegmentTimerRef.current = null;
    }
    if (tabRecorderRef.current && tabRecorderRef.current.state !== "inactive") {
      tabRecorderRef.current.stop();
    }
    tabRecorderRef.current = null;
    displayStreamRef.current?.getTracks().forEach((t) => t.stop());
    displayStreamRef.current = null;
    audioOnlyStreamRef.current?.getTracks().forEach((t) => t.stop());
    audioOnlyStreamRef.current = null;

    setIsLive(false);
    if (lectureIdRef.current) {
      try {
        await api.stopLiveLecture(lectureIdRef.current);
      } catch (e: any) {
        setError(e.message || "Couldn't stop the lecture cleanly.");
      }
    }
  }

  async function handleToggleGeneralKnowledge() {
    if (!lectureIdRef.current) return;
    const next = !generalKnowledge;
    setGeneralKnowledge(next); // optimistic
    try {
      await api.setGeneralKnowledge(lectureIdRef.current, next);
    } catch (e: any) {
      setGeneralKnowledge(!next); // revert on failure
      setError(e.message || "Couldn't update the setting.");
    }
  }

  // ================= UI =================

  if (!isLive && !lectureId) {
    return (
      <div className="border border-chalk bg-white/60 rounded-lg p-8 shadow-card text-center">
        <h2 className="font-display text-2xl text-ink mb-2">Start today&apos;s lecture</h2>
        <p className="text-sm text-ink/60 mb-6 max-w-md mx-auto">
          Choose an audio source, then start. Each finalized segment is indexed as you go, so
          students can ask questions right away.
        </p>

        <div className="flex items-center justify-center gap-2 mb-4">
          <button
            onClick={() => setCaptureMode("mic")}
            className={`px-4 py-2 rounded-md text-sm font-medium border transition-colors ${
              captureMode === "mic"
                ? "bg-ink text-paper border-ink"
                : "border-chalk text-ink/60 hover:border-ink/40"
            }`}
          >
            🎤 Microphone
          </button>
          <button
            onClick={() => setCaptureMode("tab")}
            className={`px-4 py-2 rounded-md text-sm font-medium border transition-colors ${
              captureMode === "tab"
                ? "bg-ink text-paper border-ink"
                : "border-chalk text-ink/60 hover:border-ink/40"
            }`}
          >
            🖥️ Screen / Tab Audio
          </button>
        </div>

        <p className="text-xs text-ink/50 mb-6 max-w-md mx-auto">
          {captureMode === "mic"
            ? "Uses your microphone directly - best when you're speaking into the laptop yourself."
            : 'You\'ll be asked to pick a tab, window, or screen. Be sure to check "Share tab audio" ' +
              '(or "Share system audio") in the picker, or nothing will be transcribed. On macOS, Chrome ' +
              "can only capture a shared tab's audio, not full system audio, without extra OS-level software."}
        </p>

        <button
          onClick={handleStart}
          disabled={starting}
          className="px-6 py-3 rounded-md bg-ink text-paper text-sm font-medium disabled:opacity-40 hover:bg-accent-dark transition-colors"
        >
          {starting ? "Starting\u2026" : "\u25CF Start Live Lecture"}
        </button>
        {error && <p className="text-sm text-warn mt-4">{error}</p>}
      </div>
    );
  }

  return (
    <div className="border border-chalk bg-white/60 rounded-lg p-6 shadow-card">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          {isLive ? (
            <span className="inline-flex items-center gap-1.5 text-warn text-sm font-medium">
              <span className="w-2 h-2 rounded-full bg-warn animate-pulse" />
              LIVE
            </span>
          ) : (
            <span className="text-ink/40 text-sm font-medium">Lecture ended</span>
          )}
          <span className="font-mono text-xs text-ink/40">{formatElapsed(elapsed)}</span>
          {activeCaptureMode && (
            <span className="text-xs text-ink/30 font-mono">
              &middot; {activeCaptureMode === "mic" ? "microphone" : "screen/tab audio"}
            </span>
          )}
        </div>
        {isLive && (
          <button
            onClick={handleStop}
            className="px-4 py-1.5 rounded-md border border-warn text-warn text-xs font-medium hover:bg-warn/10 transition-colors"
          >
            Stop Lecture
          </button>
        )}
      </div>

      {error && <p className="text-sm text-warn mt-2">{error}</p>}
      {indexingWarning && (
        <p className="text-xs text-warn/80 mt-1">Note: {indexingWarning}</p>
      )}

      <div className="flex items-center justify-between mt-5 mb-2">
        <h3 className="font-display text-lg text-ink">Live transcript</h3>
        <label className="flex items-center gap-2 text-xs text-ink/60 cursor-pointer select-none">
          Allow General Knowledge
          <button
            role="switch"
            aria-checked={generalKnowledge}
            onClick={handleToggleGeneralKnowledge}
            disabled={!lectureId}
            className={`w-9 h-5 rounded-full transition-colors relative ${
              generalKnowledge ? "bg-accent" : "bg-chalk"
            }`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                generalKnowledge ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
          <span className="font-mono">{generalKnowledge ? "ON" : "OFF"}</span>
        </label>
      </div>

      <div className="max-h-72 overflow-y-auto scrollbar-thin flex flex-col gap-2 pr-1 border-t border-chalk pt-3">
        {segments.length === 0 && (
          <p className="text-sm text-ink/40 italic">
            {isLive
              ? activeCaptureMode === "tab"
                ? "Listening\u2026 the first transcript segment can take a few seconds to appear."
                : "Listening\u2026 start speaking to see the transcript appear."
              : "No transcript captured."}
          </p>
        )}
        {segments.map((seg, i) => (
          <div key={i} className="flex gap-3 text-sm">
            <span className="font-mono text-xs text-accent-dark/60 shrink-0 pt-0.5">
              {formatElapsed(seg.start)}
            </span>
            <p className="text-ink/75 leading-relaxed">{seg.text}</p>
          </div>
        ))}
      </div>

      {lectureId && (
        <div className="mt-5 pt-4 border-t border-chalk flex items-center justify-between">
          <span className="text-xs text-ink/40 font-mono">{segments.length} chunks indexed</span>
          <Link
            href={`/classroom/${lectureId}`}
            className="text-sm text-accent-dark hover:underline"
          >
            Open student classroom &rarr;
          </Link>
        </div>
      )}
    </div>
  );
}
