import { app, BrowserWindow, ipcMain } from "electron";
import { IPC, type UpdateState } from "@shared/types";

/**
 * Background auto-update via electron-updater. Checks the GitHub Release feed
 * that CI publishes, downloads a newer version, and installs it on quit. The
 * renderer shows a small "restart to update" banner when a build is ready.
 *
 * No-op in development (updates only make sense for packaged, published apps).
 */
export function initAutoUpdate(): void {
  ipcMain.handle(IPC.updateInstall, async () => {
    const { autoUpdater } = await import("electron-updater");
    autoUpdater.quitAndInstall();
  });

  if (!app.isPackaged) return;

  void setup();
}

function broadcast(state: UpdateState): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.updateStatus, state);
  }
}

async function setup(): Promise<void> {
  try {
    const { autoUpdater } = await import("electron-updater");
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on("checking-for-update", () => broadcast({ status: "checking" }));
    autoUpdater.on("update-available", (info) =>
      broadcast({ status: "available", version: info?.version }),
    );
    autoUpdater.on("update-not-available", () => broadcast({ status: "none" }));
    autoUpdater.on("download-progress", (p) =>
      broadcast({ status: "downloading", percent: Math.round(p?.percent ?? 0) }),
    );
    autoUpdater.on("update-downloaded", (info) =>
      broadcast({ status: "ready", version: info?.version }),
    );
    autoUpdater.on("error", (err) =>
      broadcast({ status: "error", message: err?.message ?? String(err) }),
    );

    await autoUpdater.checkForUpdates();

    // Re-check periodically in case the app stays open for a long time.
    setInterval(
      () => {
        autoUpdater.checkForUpdates().catch(() => {});
      },
      1000 * 60 * 60 * 3,
    );
  } catch {
    /* updater unavailable — ignore */
  }
}
