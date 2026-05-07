"use client";

export default function BackButton() {
  return (
    <button
      onClick={() => window.history.back()}
      className="w-fit text-sm text-white/60 hover:text-white transition"
    >
      ← Back
    </button>
  );
}
