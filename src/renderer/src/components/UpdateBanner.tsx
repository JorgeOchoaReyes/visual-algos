import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Download, RefreshCw } from "lucide-react";
import type { UpdateState } from "@shared/types";

export function UpdateBanner() {
  const [state, setState] = useState<UpdateState>({ status: "none" });

  useEffect(() => window.api.updates.onStatus(setState), []);

  const show = state.status === "downloading" || state.status === "ready";

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          className="fixed bottom-5 left-1/2 z-40 -translate-x-1/2"
        >
          <div className="flex items-center gap-3 rounded-full border border-white/10 bg-[#151a24]/95 px-4 py-2.5 shadow-2xl shadow-black/50 backdrop-blur">
            {state.status === "downloading" ? (
              <>
                <Download size={16} className="text-accent" />
                <span className="text-sm text-white/80">
                  Downloading update… {state.percent ?? 0}%
                </span>
              </>
            ) : (
              <>
                <span className="text-sm text-white/80">
                  Update {state.version ? `v${state.version} ` : ""}ready
                </span>
                <button
                  onClick={() => window.api.updates.install()}
                  className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-sm font-medium text-white hover:bg-accent/90"
                >
                  <RefreshCw size={14} /> Restart
                </button>
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
