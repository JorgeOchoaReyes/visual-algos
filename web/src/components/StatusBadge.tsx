import { STATUS_LABELS, type VisualizationStatus } from "@/lib/types";

const STYLES: Record<VisualizationStatus, string> = {
  queued: "bg-white/10 text-white/70",
  generating: "bg-accent2/20 text-accent2",
  rendering: "bg-accent/20 text-accent",
  ready: "bg-emerald-500/20 text-emerald-300",
  error: "bg-red-500/20 text-red-300",
};

export function StatusBadge({ status }: { status: VisualizationStatus }) {
  const inProgress = status === "queued" || status === "generating" || status === "rendering";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${STYLES[status]}`}
    >
      {inProgress && (
        <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse-soft" />
      )}
      {STATUS_LABELS[status]}
    </span>
  );
}
