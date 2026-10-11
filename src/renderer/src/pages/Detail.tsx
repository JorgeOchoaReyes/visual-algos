import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  Code2,
  FolderOpen,
  ListOrdered,
  Loader2,
  RotateCw,
  Trash2,
  Volume2,
} from "lucide-react";
import { VIDEO_THEMES, isTerminal, type VisualizationStatus } from "@shared/types";
import { CodeBlock } from "../components/CodeBlock";
import { StatusBadge } from "../components/StatusBadge";
import { useVisualization } from "../lib/hooks";

const STEPS: { key: VisualizationStatus; label: string }[] = [
  { key: "generating", label: "Writing the scene" },
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
                    : "border-white/10 text-white/30"
              }`}
            >
              {done ? <Check size={13} /> : active ? <Loader2 size={13} className="animate-spin" /> : i + 1}
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

  async function onRegenerate() {
    try {
      await window.api.visualizations.regenerate(id);
    } catch {
      /* status will reflect any error */
    }
  }

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
        <Loader2 size={28} className="animate-spin text-accent" />
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

  const concept = (viz.mode ?? "algorithm") === "concept";
  const meta = [
    viz.durationSeconds ? `${Math.round(viz.durationSeconds)}s` : null,
    (viz.orientation ?? "landscape") === "portrait" ? "Short · 9:16" : "Landscape · 16:9",
    viz.theme ? VIDEO_THEMES.find((t) => t.id === viz.theme)?.label : null,
    viz.hasAudio ? "Narrated" : null,
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <Link
        to="/"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-white/45 transition hover:text-white"
      >
        <ArrowLeft size={14} /> Library
      </Link>

      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold leading-tight tracking-tight">{viz.title || viz.topic}</h1>
          {viz.tradition && <p className="mt-1 text-[13px] italic text-white/45">{viz.tradition}</p>}
          {viz.title && viz.title !== viz.topic && (
            <p className="mt-1 truncate text-[13px] text-white/40">“{viz.topic}”</p>
          )}
        </div>
        {viz.status !== "ready" && <StatusBadge status={viz.status} />}
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.99 }}
        animate={{ opacity: 1, scale: 1 }}
        className="overflow-hidden rounded-xl border border-edge bg-black shadow-pixel"
      >
        {viz.status === "ready" && viz.videoPath ? (
          <video
            key={viz.id}
            src={window.api.video.url(viz.id)}
            controls
            autoPlay
            playsInline
            className={`w-full ${(viz.orientation ?? "landscape") === "portrait" ? "mx-auto aspect-[9/16] max-h-[70vh]" : "aspect-video"}`}
          />
        ) : viz.status === "error" ? (
          <div className="flex aspect-video w-full flex-col justify-center bg-panel p-8">
            <p className="flex items-center gap-2 font-medium text-red-300">
              <AlertTriangle size={17} /> Generation failed
            </p>
            <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-edge bg-ink/60 p-3 font-mono text-xs text-white/55">
              {viz.error || "Unknown error."}
            </pre>
            <div>
              <button onClick={onRegenerate} className="btn8 mt-4">
                <RotateCw size={14} /> Try again
              </button>
            </div>
          </div>
        ) : (
          <div className="grid-bg flex aspect-video w-full flex-col justify-center bg-panel px-10">
            <Progress status={viz.status} />
            <p className="mt-6 text-xs text-white/40">This updates live — you can leave this page.</p>
          </div>
        )}
      </motion.div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-white/45">
          {meta.map((m, i) => (
            <span key={i} className="rounded-md border border-edge bg-white/[0.02] px-2 py-1">
              {m}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {viz.status === "ready" && viz.videoPath && (
            <button onClick={() => window.api.video.revealInFolder(viz.videoPath!)} className="btn8 btn8--ghost">
              <FolderOpen size={15} /> Show in folder
            </button>
          )}
          {viz.status === "ready" && (
            <button onClick={onRegenerate} className="btn8 btn8--ghost">
              <RotateCw size={15} /> Regenerate
            </button>
          )}
          <button
            onClick={onDelete}
            disabled={deleting}
            title="Delete video"
            className="btn8 btn8--ghost w-9 px-0 hover:!border-red-500/40 hover:!text-red-300"
          >
            {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
          </button>
        </div>
      </div>

      {viz.note && viz.status === "ready" && (
        <p className="mt-4 rounded-lg border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2.5 text-xs text-amber-200">
          {viz.note}
        </p>
      )}

      {viz.description && (
        <p className="mt-5 max-w-3xl text-[14px] leading-relaxed text-white/70">{viz.description}</p>
      )}

      <div className="mt-6 space-y-3">
        {viz.narration && isTerminal(viz.status) && (
          <Section icon={<Volume2 size={15} />} title={viz.hasAudio ? "Narration script" : "Script"}>
            <p className="text-[13.5px] leading-relaxed text-white/70">{viz.narration}</p>
          </Section>
        )}
        {viz.manimCode && isTerminal(viz.status) && (
          <Section icon={concept ? <ListOrdered size={15} /> : <Code2 size={15} />} title={concept ? "The argument" : "Code shown in the video"}>
            {concept ? (
              <ol className="list-inside list-decimal space-y-1.5 text-[13.5px] leading-relaxed text-white/70">
                {viz.manimCode.split("\n").map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ol>
            ) : (
              <CodeBlock code={viz.manimCode} language={viz.language || "python"} />
            )}
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <details className="panel8 group">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[14px] font-medium text-white/80">
        <span className="flex items-center gap-2">
          <span className="text-white/45">{icon}</span>
          {title}
        </span>
        <ChevronDown size={16} className="text-white/40 transition group-open:rotate-180" />
      </summary>
      <div className="border-t border-edge p-4">{children}</div>
    </details>
  );
}
