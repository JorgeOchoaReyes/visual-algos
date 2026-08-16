import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { isTerminal, type VisualizationStatus } from "@shared/types";
import { CodeBlock } from "../components/CodeBlock";
import { StatusBadge } from "../components/StatusBadge";
import { useVisualization } from "../lib/hooks";

const STEPS: { key: VisualizationStatus; label: string }[] = [
  { key: "generating", label: "Writing the Manim scene" },
  { key: "rendering", label: "Rendering the video" },
  { key: "ready", label: "Done" },
];

function Progress({ status }: { status: VisualizationStatus }) {
  const order = ["generating", "rendering", "ready"];
  const current = order.indexOf(status);
  return (
    <ol className="space-y-3">
      {STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={step.key} className="flex items-center gap-3">
            <span
              className={`grid h-6 w-6 place-items-center rounded-full border text-xs ${
                done
                  ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-300"
                  : active
                    ? "border-accent bg-accent/20 text-accent"
                    : "border-edge text-white/30"
              }`}
            >
              {done ? "✓" : active ? (
                <span className="h-2 w-2 rounded-full bg-current animate-pulse-soft" />
              ) : (
                i + 1
              )}
            </span>
            <span className={active ? "text-white" : done ? "text-white/60" : "text-white/35"}>
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function Detail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const viz = useVisualization(id);
  const [deleting, setDeleting] = useState(false);

  async function onDelete() {
    if (!confirm("Delete this video? This can't be undone.")) return;
    setDeleting(true);
    try {
      await window.api.visualizations.remove(id);
      navigate("/");
    } catch {
      setDeleting(false);
    }
  }

  if (viz === undefined) {
    return (
      <div className="grid min-h-[50vh] place-items-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-edge border-t-accent" />
      </div>
    );
  }

  if (viz === null) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-white/60">This video no longer exists.</p>
        <Link to="/" className="mt-4 inline-block text-accent hover:underline">
          Back to your videos
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold leading-snug">{viz.title || viz.topic}</h1>
          <p className="mt-1 text-sm text-white/50">{viz.topic}</p>
        </div>
        <StatusBadge status={viz.status} />
      </div>

      <div className="overflow-hidden rounded-2xl border border-edge bg-black">
        {viz.status === "ready" && viz.videoPath ? (
          <video
            key={viz.id}
            src={window.api.video.url(viz.id)}
            controls
            playsInline
            className="aspect-video w-full"
          />
        ) : viz.status === "error" ? (
          <div className="aspect-video w-full overflow-auto bg-panel p-8">
            <p className="font-medium text-red-300">Rendering failed</p>
            <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-white/50">
              {viz.error || "Unknown error."}
            </pre>
          </div>
        ) : (
          <div className="aspect-video w-full bg-panel p-8">
            <Progress status={viz.status} />
            <p className="mt-6 text-xs text-white/40">This updates live — no need to refresh.</p>
          </div>
        )}
      </div>

      {viz.description && (
        <p className="mt-5 text-sm leading-relaxed text-white/70">{viz.description}</p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {viz.status === "ready" && viz.videoPath && (
          <button
            onClick={() => window.api.video.revealInFolder(viz.videoPath!)}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
          >
            Show in folder
          </button>
        )}
        <button
          onClick={onDelete}
          disabled={deleting}
          className="rounded-lg border border-edge px-4 py-2 text-sm text-white/60 hover:border-red-500/40 hover:text-red-300 disabled:opacity-50"
        >
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </div>

      {viz.manimCode && isTerminal(viz.status) && (
        <div className="mt-10">
          <h2 className="mb-3 text-sm font-medium text-white/70">Generated Manim scene</h2>
          <CodeBlock code={viz.manimCode} />
        </div>
      )}
    </div>
  );
}
