import { app, ipcMain, shell, BrowserWindow } from "electron";
import { IPC, type CreateVisualizationInput, type Settings } from "@shared/types";
import {
  getSettings,
  setSettings,
  listVisualizations,
  getVisualization,
} from "./store";
import { checkEnv, installManim } from "./env";
import { logFilePath } from "./log";
import { voiceSample } from "./elevenlabs";
import {
  createVisualization,
  deleteVisualizationAndVideo,
  onVisualizationChanged,
  regenerateVisualization,
} from "./service";

/** Register all IPC handlers and set up the change broadcast to renderers. */
export function registerIpc(): void {
  // Broadcast visualization changes to every open window.
  onVisualizationChanged((viz) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.vizChanged, viz);
    }
  });

  ipcMain.handle(IPC.settingsGet, () => {
    // Never expose the raw key length aside; the renderer needs it to show a
    // masked "set / not set" state, so we return it (app is local & single-user).
    return getSettings();
  });

  ipcMain.handle(IPC.settingsSet, (_e, patch: Partial<Settings>) => setSettings(patch));

  ipcMain.handle(IPC.appVersion, () => app.getVersion());

  ipcMain.handle(IPC.openLogs, () => shell.openPath(logFilePath()));

  ipcMain.handle(IPC.envCheck, () => checkEnv());

  ipcMain.handle(IPC.envInstallManim, async (e) => {
    const send = (line: string) => e.sender.send("env:install-log", line);
    return installManim(send);
  });

  ipcMain.handle(IPC.vizList, () => listVisualizations());

  ipcMain.handle(IPC.vizGet, (_e, id: string) => getVisualization(id));

  ipcMain.handle(IPC.vizCreate, (_e, input: CreateVisualizationInput) =>
    createVisualization(input),
  );

  ipcMain.handle(IPC.vizRegenerate, (_e, id: string) => regenerateVisualization(id));

  ipcMain.handle(IPC.voiceSample, (_e, voiceId: string) =>
    voiceSample({ apiKey: getSettings().elevenLabsApiKey, voiceId }),
  );

  ipcMain.handle(IPC.vizDelete, (_e, id: string) => {
    deleteVisualizationAndVideo(id);
    return { ok: true };
  });

  ipcMain.handle(IPC.videoReveal, (_e, path: string) => {
    if (path) shell.showItemInFolder(path);
    return { ok: true };
  });
}
