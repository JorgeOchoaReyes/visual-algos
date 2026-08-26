import { app, BrowserWindow, ipcMain, shell } from "electron";
import { IPC, type UpdateState } from "@shared/types";

const RELEASES_URL = "https://github.com/JorgeOchoaReyes/visual-algos/releases/latest";

/**
 * Auto-update via electron-updater against the GitHub Release feed CI publishes.
 *
 * Platform reality:
 *  - Windows / Linux: full silent auto-update works (download in background,
 *    apply on restart).
 *  - macOS: Squirrel.Mac REQUIRES a Developer-ID code signature to install an
 *    update. Our builds are only ad-hoc signed (no paid Apple cert), so silent
 *    install is impossible — attempting it just errors. On macOS we therefore
 *    only DETECT a newer version and point the user at the download page so they
 *    can grab the new .dmg manually.
 */

const isMac = process.platform === "darwin";
let lastVersion: string | undefined;

function broadcast(state: UpdateState): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.updateStatus, state);
  }
}

export function initAutoUpdate(): void {
  // Apply a downloaded update now (Windows/Linux only — no-op on unsigned mac).
  ipcMain.handle(IPC.updateInstall, async () => {
    if (isMac) {
      await shell.openExternal(RELEASES_URL);
      return;
    }
    const { autoUpdater } = await import("electron-updater");
    autoUpdater.quitAndInstall();
  });

  // Open the Releases page so the user can download the latest build manually
  // (the practical path on macOS, and a fallback everywhere).
  ipcMain.handle(IPC.updateOpenDownload, async () => {
    await shell.openExternal(RELEASES_URL);
  });

  // Trigger a check on demand (the "Check for updates" button).
  ipcMain.handle(IPC.updateCheck, async () => {
    if (!app.isPackaged) {
      broadcast({ status: "none", message: "Updates only apply to installed builds." });
      return;
    }
    try {
      const { autoUpdater } = await import("electron-updater");
      await autoUpdater.checkForUpdates();
    } catch (err) {
      broadcast({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  });

  if (!app.isPackaged) return;
  void setup();
}

async function setup(): Promise<void> {
  try {
    const { autoUpdater } = await import("electron-updater");
    // On macOS an unsigned app can't install the update, so don't waste a
    // background download — just detect and surface it.
    autoUpdater.autoDownload = !isMac;
    autoUpdater.autoInstallOnAppQuit = !isMac;

    autoUpdater.on("checking-for-update", () => broadcast({ status: "checking" }));
    autoUpdater.on("update-available", (info) => {
      lastVersion = info?.version;
      // On mac we can't install, so "available" is the terminal state (with a
      // download link in the UI). On win/linux it will proceed to download.
      broadcast({ status: "available", version: info?.version });
    });
    autoUpdater.on("update-not-available", () => broadcast({ status: "none" }));
    autoUpdater.on("download-progress", (p) =>
      broadcast({ status: "downloading", percent: Math.round(p?.percent ?? 0) }),
    );
    autoUpdater.on("update-downloaded", (info) =>
      broadcast({ status: "ready", version: info?.version ?? lastVersion }),
    );
    autoUpdater.on("error", (err) =>
      broadcast({ status: "error", message: err?.message ?? String(err) }),
    );

    await autoUpdater.checkForUpdates();

    // Re-check periodically for long-running sessions.
    setInterval(() => {
      autoUpdater.checkForUpdates().catch(() => {});
    }, 1000 * 60 * 60 * 3);
  } catch {
    /* updater unavailable — ignore */
  }
}
