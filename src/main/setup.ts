import { BrowserWindow, ipcMain } from "electron";
import { IPC, type SetupState } from "@shared/types";
import { checkEnv, installManim } from "./env";

let running = false;

function broadcast(state: SetupState): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.setupStatus, state);
  }
}

/**
 * On launch, make sure the render environment (Python + Manim) is ready. If the
 * bundled runtime already imports manim, we're done instantly. Otherwise we
 * auto-create a managed venv (from the bundled Python — no system Python needed)
 * and pip-install manim once. It persists in userData, so this is a one-time
 * cost, not every launch.
 */
export async function ensureRenderer(): Promise<void> {
  if (running) return;
  running = true;
  try {
    broadcast({ phase: "checking" });
    let env = await checkEnv();
    if (env.ready) {
      broadcast({ phase: "ready" });
      return;
    }

    broadcast({
      phase: "installing",
      message: "Setting up the rendering engine (one-time)…",
    });
    await installManim((line) => broadcast({ phase: "installing", log: line }));

    env = await checkEnv();
    broadcast(
      env.ready
        ? { phase: "ready" }
        : {
            phase: "error",
            message:
              "Couldn't set up the renderer automatically. Open Settings → Render environment for details.",
          },
    );
  } catch (err) {
    broadcast({ phase: "error", message: err instanceof Error ? err.message : String(err) });
  } finally {
    running = false;
  }
}

export function registerSetup(): void {
  // Let the renderer trigger a retry (e.g. from a Settings button).
  ipcMain.handle(IPC.setupRetry, () => ensureRenderer());
}
