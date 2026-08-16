"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { createVisualization } from "@/lib/visualizations";
import type { RenderQuality } from "@/lib/types";

const QUALITIES: { value: RenderQuality; label: string; hint: string }[] = [
  { value: "l", label: "Fast", hint: "480p · quickest" },
  { value: "m", label: "Balanced", hint: "720p" },
  { value: "h", label: "High", hint: "1080p · slower" },
];

function NewForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [topic, setTopic] = useState(params.get("topic") ?? "");
  const [quality, setQuality] = useState<RenderQuality>("m");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const t = topic.trim();
    if (t.length < 3) {
      setError("Please enter a topic (at least a few words).");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const id = await createVisualization({ topic: t, quality });
      router.push(`/v/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-2xl font-semibold">New video</h1>
      <p className="mt-1 text-sm text-white/55">
        Describe a computer-science concept. The clearer the ask, the better the animation.
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-6">
        <div>
          <label className="mb-2 block text-sm font-medium text-white/80">Topic</label>
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={3}
            autoFocus
            placeholder="e.g. Visualize how merge sort recursively splits and merges an array"
            className="w-full resize-none rounded-xl border border-edge bg-panel px-4 py-3 text-sm outline-none placeholder:text-white/30 focus:border-accent"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-white/80">Quality</label>
          <div className="grid grid-cols-3 gap-2">
            {QUALITIES.map((q) => (
              <button
                type="button"
                key={q.value}
                onClick={() => setQuality(q.value)}
                className={`rounded-xl border px-3 py-2.5 text-left transition ${
                  quality === q.value
                    ? "border-accent bg-accent/10"
                    : "border-edge bg-panel hover:border-white/20"
                }`}
              >
                <div className="text-sm font-medium">{q.label}</div>
                <div className="text-xs text-white/45">{q.hint}</div>
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-xl bg-accent px-4 py-3 font-medium text-white hover:bg-accent/90 disabled:opacity-60"
        >
          {submitting ? "Starting…" : "Generate video"}
        </button>
        <p className="text-center text-xs text-white/40">
          Rendering can take a minute or two. You can leave this page — it'll appear in your library.
        </p>
      </form>
    </div>
  );
}

export default function NewPage() {
  return (
    <AuthGate>
      <Suspense fallback={<div className="p-12" />}>
        <NewForm />
      </Suspense>
    </AuthGate>
  );
}
