import { Link } from "react-router-dom";
import type { Visualization } from "@shared/types";
import { StatusBadge } from "./StatusBadge";

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function VisualizationCard({ v }: { v: Visualization }) {
  return (
    <Link
      to={`/v/${v.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-edge bg-panel transition hover:border-accent/50"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-black">
        {v.status === "ready" && v.videoPath ? (
          <video
            src={window.api.video.url(v.id)}
            muted
            playsInline
            preload="metadata"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-white/30">
            {v.status === "error" ? (
              <span className="text-2xl">⚠︎</span>
            ) : (
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-edge border-t-accent" />
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
  );
}
