import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import type { SetupState } from "@shared/types";

/**
 * First-run / recovery banner. The main process auto-checks the render
 * environment on launch and installs Manim if needed; this shows progress so
 * the user never has to manually configure anything.
 */
export function SetupBanner() {
  const [state, setState] = useState<SetupState>({ phase: "checking" });

  useEffect(() => window.api.setup.onStatus(setState), []);

  const show = state.phase === "installing" || state.phase === "error";

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          className="fixed bottom-5 left-1/2 z-40 w-[min(92vw,560px)] -translate-x-1/2"
        >
          <div className="rounded-2xl border border-edge bg-panel/95 p-4 shadow-pixel backdrop-blur">
            {state.phase === "installing" ? (
              <>
                <div className="flex items-center gap-2 text-sm font-semibold text-accent">
                  <Loader2 size={16} className="animate-spin" />
                  {state.message || "Setting up the rendering engine…"}
                </div>
                <p className="mt-1 text-xs text-white/50">
                  One-time setup — this persists, so it won't run every launch.
                </p>
                {state.log && (
                  <pre className="mt-2 max-h-24 overflow-auto rounded-lg border border-edge bg-ink/70 p-2 font-mono text-[10px] leading-relaxed text-white/60">
                    {state.log}
                  </pre>
                )}
              </>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-300" />
                  <span className="text-sm text-white/80">
                    {state.message || "Renderer setup failed."}
                  </span>
                </div>
                <button
                  onClick={() => window.api.setup.retry()}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90"
                >
                  <RefreshCw size={14} /> Retry
                </button>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
