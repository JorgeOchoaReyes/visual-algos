import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Plus, Clapperboard } from "lucide-react";
import { VisualizationCard } from "../components/VisualizationCard";
import { useVisualizations } from "../lib/hooks";

export function Library() {
  const { items } = useVisualizations();

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-6">
        <h1 className="flex items-baseline gap-2.5 text-[26px] font-semibold tracking-tight">
          Your videos
          {items && items.length > 0 && <span className="text-base font-normal text-white/35">{items.length}</span>}
        </h1>
        <p className="mt-1 text-[13.5px] text-white/50">
          Rendered on your machine — only the topic you type is sent to the model.
        </p>
      </div>

      {items === null ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-60 animate-pulse rounded-[0.9rem] border border-edge bg-panel/60" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="grid-bg relative overflow-hidden rounded-2xl border border-dashed border-edge bg-panel/40 p-16 text-center"
        >
          <div className="tile8 mx-auto mb-4 grid h-14 w-14 place-items-center">
            <Clapperboard size={24} className="text-white" />
          </div>
          <h2 className="text-lg font-medium">No videos yet</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-white/55">
            Describe any topic and Vizuals animates it into a 3Blue1Brown-style video —
            code, a diagram, a comparison, or an animated concept.
          </p>
          <Link to="/new" className="btn8 btn8--magenta mt-6">
            <Plus size={16} /> Create your first one
          </Link>
        </motion.div>
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
