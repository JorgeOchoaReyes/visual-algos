import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { EnvStatus, RenderQuality } from "@shared/types";

const QUALITIES: { value: RenderQuality; label: string; hint: string }[] = [
  { value: "l", label: "Fast", hint: "480p" },
  { value: "m", label: "Balanced", hint: "720p" },
  { value: "h", label: "High", hint: "1080p · slower" },
];

const EXAMPLES = [
  "Binary search on a sorted array",
  "Dijkstra's shortest path",
  "Quicksort partitioning",
  "How a hash table handles collisions",
  "Breadth-first search on a graph",
];

export function New({
  canGenerate,
  hasKey,
  env,
}: {
  canGenerate: boolean;
  hasKey: boolean;
  env: EnvStatus | null;
}) {
  const navigate = useNavigate();
  const [topic, setTopic] = useState("");
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
      const { id } = await window.api.visualizations.create({ topic: t, quality });
      navigate(`/v/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-2xl font-semibold">New video</h1>
      <p className="mt-1 text-sm text-white/55">
        Describe a computer-science concept. The video shows the algorithm's code and highlights
        each line as it runs, in sync with the visual. The clearer the ask, the better the animation.
      </p>

      {!canGenerate && (
        <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          <p className="font-medium text-amber-200">Setup needed before you can generate</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-amber-100/80">
            {!hasKey && <li>Add your Gemini API key.</li>}
            {env && !env.python.ok && <li>Python 3.10+ was not found.</li>}
            {env && env.python.ok && !env.manim.ok && (
              <li>Manim is not installed for the detected Python.</li>
            )}
          </ul>
          <Link
            to="/settings"
            className="mt-3 inline-block rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-semibold text-black hover:bg-amber-300"
          >
            Open Settings
          </Link>
        </div>
      )}

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
          <div className="mt-3 flex flex-wrap gap-2">
            {EXAMPLES.map((e) => (
              <button
                type="button"
                key={e}
                onClick={() => setTopic(e)}
                className="rounded-full border border-edge bg-panel px-3 py-1 text-xs text-white/60 hover:border-accent/50 hover:text-white"
              >
                {e}
              </button>
            ))}
          </div>
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
          disabled={submitting || !canGenerate}
          className="w-full rounded-xl bg-accent px-4 py-3 font-medium text-white hover:bg-accent/90 disabled:opacity-50"
        >
          {submitting ? "Starting…" : "Generate video"}
        </button>
        <p className="text-center text-xs text-white/40">
          Rendering runs on your machine and can take a minute or two. You can leave this page.
        </p>
      </form>
    </div>
  );
}
