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
      whileHover={{ y: -3 }}
    >
      <Link
        to={`/v/${v.id}`}
        className="card8 group flex h-full flex-col overflow-hidden"
      >
        <div className="relative aspect-video w-full overflow-hidden bg-black">
          {ready ? (
            <>
              <video
                src={window.api.video.url(v.id)}
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
            <div className="grid h-full w-full place-items-center bg-ink/40 text-white/30">
              {v.status === "error" ? (
                <AlertTriangle size={22} className="text-red-400/70" />
              ) : (
                <Loader2 size={22} className="animate-spin text-accent/70" />
              )}
            </div>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-2 p-4">
          <h3 className="line-clamp-2 font-medium leading-snug group-hover:text-white">
            {v.title || v.topic}
          </h3>
          <div className="mt-auto flex items-center justify-between pt-2">
            <StatusBadge status={v.status} />
            <span className="text-xs text-white/40">{timeAgo(v.createdAt)}</span>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
