import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Code2, Gauge, MonitorSmartphone, Sparkles, Volume2, Wand2, AlertCircle } from "lucide-react";
import {
  estimateVideoCost,
  formatUsd,
  LANGUAGES,
  ORIENTATIONS,
  providerLabel,
  type AiProvider,
  type EnvStatus,
  type Orientation,
  type RenderQuality,
} from "@shared/types";
import { Toggle } from "../components/Toggle";
import { Dropdown } from "../components/Dropdown";

const QUALITIES: { value: RenderQuality; label: string; hint: string }[] = [
  { value: "l", label: "Fast", hint: "480p" },
  { value: "m", label: "Balanced", hint: "720p" },
  { value: "h", label: "High", hint: "1080p · slower" },
];

const EXAMPLES = [
  "Binary search on a sorted array",
  "Dijkstra's shortest path",
  "Quicksort partitioning",
  "Hash table collisions",
  "Breadth-first search on a graph",
];

export function New({
  canGenerate,
  hasKey,
  env,
  hasElevenLabs,
  provider,
  model,
}: {
  canGenerate: boolean;
  hasKey: boolean;
  env: EnvStatus | null;
  hasElevenLabs: boolean;
  provider: AiProvider;
  model: string;
}) {
  const navigate = useNavigate();
  const [topic, setTopic] = useState("");
  const [quality, setQuality] = useState<RenderQuality>("m");
  const [language, setLanguage] = useState("python");
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [narrate, setNarrate] = useState(false);
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
      const { id } = await window.api.visualizations.create({
        topic: t,
        quality,
        language,
        orientation,
        narrate: narrate && hasElevenLabs,
      });
      navigate(`/v/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="mb-1 flex items-center gap-2">
        <Wand2 size={20} className="text-accent" />
        <h1 className="text-2xl font-semibold tracking-tight">New video</h1>
      </div>
      <p className="mt-1 text-sm text-white/55">
        Describe a computer-science concept. The video shows the algorithm's code and highlights
        each line as it runs, in sync with the visual.
      </p>

      {!canGenerate && (
        <div className="mt-6 flex gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm">
          <AlertCircle size={18} className="mt-0.5 shrink-0 text-amber-300" />
          <div>
            <p className="font-medium text-amber-200">Setup needed before you can generate</p>
            <ul className="mt-1.5 list-inside list-disc space-y-1 text-amber-100/80">
              {!hasKey && <li>Add your {providerLabel(provider)} API key.</li>}
              {env && !env.python.ok && <li>Python 3.10+ was not found.</li>}
              {env && env.python.ok && !env.manim.ok && <li>Manim is not installed.</li>}
            </ul>
            <Link
              to="/settings"
              className="mt-3 inline-block rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-semibold text-black hover:bg-amber-300"
            >
              Open Settings
            </Link>
          </div>
        </div>
      )}

      <form onSubmit={onSubmit} className="mt-8 space-y-7">
        <div>
          <label className="mb-2 block text-sm font-medium text-white/80">Topic</label>
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={3}
            autoFocus
            placeholder="e.g. Visualize how merge sort recursively splits and merges an array"
            className="w-full resize-none rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm outline-none transition placeholder:text-white/30 focus:border-accent focus:bg-white/[0.05]"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {EXAMPLES.map((e) => (
              <button
                type="button"
                key={e}
                onClick={() => setTopic(e)}
                className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-white/60 transition hover:border-accent/50 hover:text-white"
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-2 flex items-center gap-1.5 text-sm font-medium text-white/80">
            <Gauge size={15} /> Quality
          </label>
          <div className="grid grid-cols-3 gap-2">
            {QUALITIES.map((q) => (
              <button
                type="button"
                key={q.value}
                onClick={() => setQuality(q.value)}
                className={`rounded-2xl border px-3 py-2.5 text-left transition ${
                  quality === q.value
                    ? "border-accent bg-accent/10"
                    : "border-white/10 bg-white/[0.03] hover:border-white/20"
                }`}
              >
                <div className="text-sm font-medium">{q.label}</div>
                <div className="text-xs text-white/45">{q.hint}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-2 flex items-center gap-1.5 text-sm font-medium text-white/80">
              <Code2 size={15} /> Language
            </label>
            <Dropdown
              value={language}
              options={LANGUAGES.map((l) => ({ value: l.id, label: l.label }))}
              onChange={setLanguage}
            />
          </div>
          <div>
            <label className="mb-2 flex items-center gap-1.5 text-sm font-medium text-white/80">
              <MonitorSmartphone size={15} /> Format
            </label>
            <div className="grid grid-cols-2 gap-2">
              {ORIENTATIONS.map((o) => (
                <button
                  type="button"
                  key={o.id}
                  onClick={() => setOrientation(o.id)}
                  className={`rounded-2xl border px-3 py-2.5 text-left transition ${
                    orientation === o.id
                      ? "border-accent bg-accent/10"
                      : "border-white/10 bg-white/[0.03] hover:border-white/20"
                  }`}
                >
                  <div className="text-sm font-medium">{o.label}</div>
                  <div className="text-xs text-white/45">{o.hint}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Narration */}
        <div
          className={`flex items-center justify-between rounded-2xl border p-4 transition ${
            narrate && hasElevenLabs ? "border-accent/40 bg-accent/[0.06]" : "border-white/10 bg-white/[0.03]"
          }`}
        >
          <div className="flex items-start gap-3">
            <Volume2 size={18} className="mt-0.5 text-accent" />
            <div>
              <div className="text-sm font-medium">AI narration</div>
              <div className="text-xs text-white/45">
                {hasElevenLabs
                  ? "Generate an ElevenLabs voiceover and add it to the video."
                  : "Add an ElevenLabs API key in Settings to enable."}
              </div>
            </div>
          </div>
          <Toggle
            checked={narrate && hasElevenLabs}
            onChange={setNarrate}
            disabled={!hasElevenLabs}
          />
        </div>

        {error && (
          <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </p>
        )}

        {(() => {
          const est = estimateVideoCost(provider, model, narrate && hasElevenLabs);
          return (
            <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-2.5 text-xs text-white/50">
              <span>Estimated API cost</span>
              <span className="text-white/70">
                ~{formatUsd(est.total)}
                <span className="text-white/40">
                  {" "}
                  ({formatUsd(est.model)} {providerLabel(provider)}
                  {est.narration > 0 ? ` + ${formatUsd(est.narration)} voice` : ""}, rendering free)
                </span>
              </span>
            </div>
          );
        })()}

        <button
          type="submit"
          disabled={submitting || !canGenerate}
          className="btn8 w-full justify-center py-3.5"
        >
          <Sparkles size={18} />
          {submitting ? "Starting…" : "Generate video"}
        </button>
        <p className="text-center text-xs text-white/40">
          Rendering runs on your machine and can take a minute or two. You can leave this page.
          Cost is approximate and depends on your API plan — on OpenRouter it varies a lot by
          model.
        </p>
      </form>
    </div>
  );
}
