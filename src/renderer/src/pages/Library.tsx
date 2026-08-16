import { Link } from "react-router-dom";
import { VisualizationCard } from "../components/VisualizationCard";
import { useVisualizations } from "../lib/hooks";

export function Library() {
  const { items } = useVisualizations();

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Your videos</h1>
          <p className="mt-1 text-sm text-white/50">
            Generated locally — nothing leaves your machine except the topic you send to Gemini.
          </p>
        </div>
        <Link
          to="/new"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
        >
          New video
        </Link>
      </div>

      {items === null ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-56 animate-pulse rounded-xl border border-edge bg-panel" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="grid-bg rounded-2xl border border-dashed border-edge bg-panel/40 p-16 text-center">
          <h2 className="text-lg font-medium">No videos yet</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-white/55">
            Describe an algorithm and Visual Algos will animate it into a 3Blue1Brown-style video.
          </p>
          <Link
            to="/new"
            className="mt-6 inline-block rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent/90"
          >
            Create your first one
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((v) => (
            <VisualizationCard key={v.id} v={v} />
          ))}
        </div>
      )}
    </div>
  );
}
