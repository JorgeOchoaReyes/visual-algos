import { CheckCircle2, Loader2, AlertTriangle, Sparkles, Clapperboard } from "lucide-react";
import { STATUS_LABELS, type VisualizationStatus } from "@shared/types";

const CONFIG: Record<
  VisualizationStatus,
  { cls: string; Icon: typeof Loader2; spin?: boolean }
> = {
  generating: { cls: "bg-accent2/15 text-accent2 border-accent2/20", Icon: Sparkles },
  rendering: { cls: "bg-accent/15 text-accent border-accent/20", Icon: Clapperboard },
  ready: { cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/20", Icon: CheckCircle2 },
  error: { cls: "bg-red-500/15 text-red-300 border-red-500/20", Icon: AlertTriangle },
};

export function StatusBadge({ status }: { status: VisualizationStatus }) {
  const inProgress = status === "generating" || status === "rendering";
  const { cls, Icon } = CONFIG[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${cls}`}
    >
      {inProgress ? (
        <Loader2 size={13} className="animate-spin" />
      ) : (
        <Icon size={13} />
      )}
      {STATUS_LABELS[status]}
    </span>
  );
}
