import { app, BrowserWindow, ipcMain, shell } from "electron";
import { IPC, type UpdateState } from "@shared/types";

const REPO = "JorgeOchoaReyes/visual-algos";
const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;

/**
 * Updates come in two independent layers:
 *
 *  1. The "Check for updates" button (manual) → always asks the GitHub Releases
 *     API for the latest version and compares. This is dead simple and works on
 *     EVERY platform: it never depends on code signing (macOS) or the
 *     electron-updater feed / app-update.yml being intact (a source of spurious
 *     "check failed" on Windows). When a newer version exists it points the user
 *     at the download.
 *
 *  2. Best-effort SILENT background auto-update on Windows/Linux via
 *     electron-updater (download in the background, apply on restart). Its errors
 *     are swallowed — the reliable manual check is the source of truth for the
 *     UI, so a background hiccup never surfaces as a scary "check failed".
 *     macOS can't self-install unsigned, so it has no background layer.
 */

const isMac = process.platform === "darwin";
let downloadedReady = false; // a background download finished (win/linux)

function broadcast(state: UpdateState): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.updateStatus, state);
  }
}

function parseVer(v: string): number[] {
  return v.replace(/^v/i, "").split(/[.\-+]/).map((n) => parseInt(n, 10) || 0);
}
function isNewer(latest: string, current: string): boolean {
  const a = parseVer(latest);
  const b = parseVer(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/** Reliable check: compare the app version against the latest GitHub release. */
async function checkViaGitHub(): Promise<void> {
  broadcast({ status: "checking" });
  try {
    const res = await fetch(LATEST_API, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "visual-algos-updater" },
    });
    if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
    const data = (await res.json()) as { tag_name?: string; name?: string };
    const latest = (data.tag_name || data.name || "").trim();
    if (!latest) throw new Error("no release found");
    broadcast(
      isNewer(latest, app.getVersion())
        ? { status: "available", version: latest.replace(/^v/i, "") }
        : { status: "none" },
    );
  } catch (err) {
    broadcast({ status: "error", message: err instanceof Error ? err.message : String(err) });
  }
}

export function initAutoUpdate(): void {
  // "Install/Restart": if a background download is ready (win/linux), apply it;
  // otherwise open the download page (macOS, or when no silent update exists).
  ipcMain.handle(IPC.updateInstall, async () => {
    if (!isMac && downloadedReady) {
      const { autoUpdater } = await import("electron-updater");
      autoUpdater.quitAndInstall();
      return;
    }
    await shell.openExternal(RELEASES_URL);
  });

  ipcMain.handle(IPC.updateOpenDownload, async () => {
    await shell.openExternal(RELEASES_URL);
  });

  // The manual button — always the reliable GitHub check.
  ipcMain.handle(IPC.updateCheck, async () => {
    if (!app.isPackaged) {
      broadcast({ status: "none", message: "Updates only apply to installed builds." });
      return;
    }
    await checkViaGitHub();
  });

  if (!app.isPackaged) return;

  // On-launch check via the reliable path (all platforms).
  void checkViaGitHub();
  setInterval(() => void checkViaGitHub(), 1000 * 60 * 60 * 3);

  // Best-effort silent background updater on Windows/Linux.
  if (!isMac) void setupSilent();
}

async function setupSilent(): Promise<void> {
  try {
    const { autoUpdater } = await import("electron-updater");
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    // Only surface the actionable silent-update states; swallow everything else
    // (including errors) so the manual check stays the UI's source of truth.
    autoUpdater.on("download-progress", (p) =>
      broadcast({ status: "downloading", percent: Math.round(p?.percent ?? 0) }),
    );
    autoUpdater.on("update-downloaded", (info) => {
      downloadedReady = true;
      broadcast({ status: "ready", version: info?.version });
    });
    autoUpdater.on("error", () => {
      /* swallowed — the manual GitHub check reports status instead */
    });
    await autoUpdater.checkForUpdates();
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 1000 * 60 * 60 * 3);
  } catch {
    /* electron-updater unavailable — the manual check still works */
  }
}
