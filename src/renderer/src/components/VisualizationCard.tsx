import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertTriangle, Loader2, Play, Volume2 } from "lucide-react";
import type { Visualization } from "@shared/types";
import { StatusBadge } from "./StatusBadge";

function timeAgo(ms: number): string {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function VisualizationCard({ v }: { v: Visualization }) {
  const ready = v.status === "ready" && v.videoPath;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <Link
        to={`/v/${v.id}`}
        className="card8 group flex h-full flex-col overflow-hidden"
      >
        <div className="relative aspect-video w-full overflow-hidden bg-black">
          {ready ? (
            <>
              <video
                // Seek a few seconds in: a metadata-only preload never paints a frame,
                // and the first second is just the title fading in.
                src={`${window.api.video.url(v.id)}#t=${Math.min(4, Math.max(0.5, (v.durationSeconds ?? 8) * 0.35)).toFixed(1)}`}
                muted
                playsInline
                preload="metadata"
                className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 grid place-items-center bg-black/0 transition group-hover:bg-black/30">
                <span className="scale-90 rounded-full bg-white/10 p-3 opacity-0 backdrop-blur transition group-hover:scale-100 group-hover:opacity-100">
                  <Play size={20} className="text-white" fill="currentColor" />
                </span>
              </div>
              {v.hasAudio && (
                <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-white/80 backdrop-blur">
                  <Volume2 size={11} /> Narrated
                </span>
              )}
            </>
          ) : (
            <div className="grid-bg flex h-full w-full flex-col items-center justify-center gap-2 bg-[#101218] text-white/40">
              {v.status === "error" ? (
                <>
                  <AlertTriangle size={20} className="text-red-400/70" />
                  <span className="text-xs">Generation failed</span>
                </>
              ) : (
                <>
                  <Loader2 size={20} className="animate-spin text-accent" />
                  <span className="text-xs">{v.status === "rendering" ? "Rendering…" : "Writing scene…"}</span>
                </>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1.5 px-4 py-3.5">
          <h3 className="line-clamp-2 text-[14px] font-medium leading-snug text-white/90 group-hover:text-white">
            {v.title || v.topic}
          </h3>
          <div className="mt-auto flex items-center justify-between pt-1.5 text-xs text-white/40">
            {v.status === "ready" ? (
              <span>
                {v.durationSeconds ? `${Math.round(v.durationSeconds)}s · ` : ""}
                {(v.orientation ?? "landscape") === "portrait" ? "Short" : "Landscape"}
              </span>
            ) : (
              <StatusBadge status={v.status} />
            )}
            <span>{timeAgo(v.createdAt)}</span>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
