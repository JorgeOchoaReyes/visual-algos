"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AuthGate } from "@/components/AuthGate";
import { CodeBlock } from "@/components/CodeBlock";
import { StatusBadge } from "@/components/StatusBadge";
import {
  deleteVisualization,
  subscribeToVisualization,
} from "@/lib/visualizations";
import { isTerminal, type Visualization } from "@/lib/types";

const STEPS: { key: Visualization["status"]; label: string }[] = [
  { key: "queued", label: "Queued" },
  { key: "generating", label: "Writing the Manim scene" },
  { key: "rendering", label: "Rendering the video" },
  { key: "ready", label: "Done" },
];

function Progress({ status }: { status: Visualization["status"] }) {
  const order = ["queued", "generating", "rendering", "ready"];
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

function Detail({ id }: { id: string }) {
  const router = useRouter();
  const [v, setV] = useState<Visualization | null | undefined>(undefined);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const unsub = subscribeToVisualization(id, (data) => setV(data));
    return () => unsub();
  }, [id]);

  async function onDelete() {
    if (!confirm("Delete this video? This can't be undone.")) return;
    setDeleting(true);
    try {
      await deleteVisualization(id);
      router.push("/dashboard");
    } catch {
      setDeleting(false);
    }
  }

  if (v === undefined) {
    return (
      <div className="grid min-h-[50vh] place-items-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-edge border-t-accent" />
      </div>
    );
  }

  if (v === null) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-white/60">This video doesn't exist or you don't have access.</p>
        <Link href="/dashboard" className="mt-4 inline-block text-accent hover:underline">
          Back to my videos
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold leading-snug">{v.title || v.topic}</h1>
          <p className="mt-1 text-sm text-white/50">{v.topic}</p>
        </div>
        <StatusBadge status={v.status} />
      </div>

      {/* Player / progress */}
      <div className="overflow-hidden rounded-2xl border border-edge bg-black">
        {v.status === "ready" && v.videoUrl ? (
          <video src={v.videoUrl} controls playsInline className="aspect-video w-full" />
        ) : v.status === "error" ? (
          <div className="aspect-video w-full bg-panel p-8">
            <p className="font-medium text-red-300">Rendering failed</p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-white/50">
              {v.error || "Unknown error."}
            </p>
          </div>
        ) : (
          <div className="aspect-video w-full bg-panel p-8">
            <Progress status={v.status} />
            <p className="mt-6 text-xs text-white/40">
              This page updates live — no need to refresh.
            </p>
          </div>
        )}
      </div>

      {v.description && (
        <p className="mt-5 text-sm leading-relaxed text-white/70">{v.description}</p>
      )}

      {/* Actions */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {v.status === "ready" && v.videoUrl && (
          <a
            href={v.videoUrl}
            download
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
          >
            Download MP4
          </a>
        )}
        <button
          onClick={onDelete}
          disabled={deleting}
          className="rounded-lg border border-edge px-4 py-2 text-sm text-white/60 hover:border-red-500/40 hover:text-red-300 disabled:opacity-50"
        >
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </div>

      {/* Generated code */}
      {v.manimCode && isTerminal(v.status) && (
        <div className="mt-10">
          <h2 className="mb-3 text-sm font-medium text-white/70">Generated Manim scene</h2>
          <CodeBlock code={v.manimCode} />
        </div>
      )}
    </div>
  );
}

export default function VisualizationPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <AuthGate>
      <Detail id={params.id} />
    </AuthGate>
  );
}
