import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Plus, Clapperboard } from "lucide-react";
import { VisualizationCard } from "../components/VisualizationCard";
import { useVisualizations } from "../lib/hooks";

export function Library() {
  const { items } = useVisualizations();

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-7 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your videos</h1>
          <p className="mt-1 text-sm text-white/50">
            Rendered locally — only the topic you enter is ever sent to Gemini.
          </p>
        </div>
        <Link to="/new" className="btn8">
          <Plus size={16} /> New video
        </Link>
      </div>

      {items === null ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-56 animate-pulse rounded-2xl border border-white/[0.06] bg-panel/60" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="grid-bg relative overflow-hidden rounded-3xl border border-dashed border-white/10 bg-panel/30 p-16 text-center"
        >
          <div className="tile8 mx-auto mb-4 grid h-14 w-14 place-items-center">
            <Clapperboard size={26} className="text-[#05040b]" />
          </div>
          <h2 className="text-lg font-medium">No videos yet</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-white/55">
            Describe an algorithm and Visual Algos animates it into a 3Blue1Brown-style video that
            walks through the code line by line.
          </p>
          <Link to="/new" className="btn8 mt-6">
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
