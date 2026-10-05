"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api";

export default function UploadCard({ onUploaded }: { onUploaded: (lectureId: string) => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const res = await api.uploadLecture(file, title || undefined);
      onUploaded(res.lecture_id);
      setFile(null);
      setTitle("");
    } catch (e: any) {
      setError(e.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="border border-chalk bg-white/60 rounded-lg p-6 shadow-card">
      <h2 className="font-display text-xl text-ink mb-1">Upload a lecture</h2>
      <p className="text-sm text-ink/50 mb-5">Audio or video &middot; mp3, wav, m4a, mp4, mov, webm</p>

      <input
        type="text"
        placeholder="Lecture title (optional)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="w-full mb-4 px-3 py-2 rounded-md border border-chalk bg-paper text-sm focus:border-accent outline-none"
      />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const dropped = e.dataTransfer.files?.[0];
          if (dropped) setFile(dropped);
        }}
        onClick={() => fileInput.current?.click()}
        className={`cursor-pointer rounded-md border-2 border-dashed px-4 py-8 text-center transition-colors ${
          dragOver ? "border-accent bg-accent/5" : "border-chalk"
        }`}
      >
        <input
          ref={fileInput}
          type="file"
          accept=".mp3,.wav,.m4a,.mp4,.mov,.webm,.ogg,.flac"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
        {file ? (
          <p className="text-sm text-ink">{file.name}</p>
        ) : (
          <p className="text-sm text-ink/50">Drag a file here, or click to browse</p>
        )}
      </div>

      {error && <p className="text-sm text-warn mt-3">{error}</p>}

      <button
        onClick={handleUpload}
        disabled={!file || uploading}
        className="mt-5 w-full py-2.5 rounded-md bg-ink text-paper text-sm font-medium disabled:opacity-40 hover:bg-accent-dark transition-colors"
      >
        {uploading ? "Uploading\u2026" : "Upload & transcribe"}
      </button>
    </div>
  );
}
