import { contextBridge, ipcRenderer } from "electron";
import {
  IPC,
  MEDIA_PROTOCOL,
  type CreateVisualizationInput,
  type EnvStatus,
  type Settings,
  type UpdateState,
  type Visualization,
} from "@shared/types";

/** The API surface exposed to the renderer as window.api. */
const api = {
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch: Partial<Settings>): Promise<Settings> =>
      ipcRenderer.invoke(IPC.settingsSet, patch),
  },
  env: {
    check: (): Promise<EnvStatus> => ipcRenderer.invoke(IPC.envCheck),
    installManim: (): Promise<EnvStatus> => ipcRenderer.invoke(IPC.envInstallManim),
    onInstallLog: (cb: (line: string) => void): (() => void) => {
      const handler = (_e: unknown, line: string) => cb(line);
      ipcRenderer.on("env:install-log", handler);
      return () => ipcRenderer.removeListener("env:install-log", handler);
    },
  },
  visualizations: {
    list: (): Promise<Visualization[]> => ipcRenderer.invoke(IPC.vizList),
    get: (id: string): Promise<Visualization | null> => ipcRenderer.invoke(IPC.vizGet, id),
    create: (input: CreateVisualizationInput): Promise<{ id: string }> =>
      ipcRenderer.invoke(IPC.vizCreate, input),
    regenerate: (id: string): Promise<{ id: string }> =>
      ipcRenderer.invoke(IPC.vizRegenerate, id),
    remove: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.vizDelete, id),
    onChanged: (cb: (viz: Visualization) => void): (() => void) => {
      const handler = (_e: unknown, viz: Visualization) => cb(viz);
      ipcRenderer.on(IPC.vizChanged, handler);
      return () => ipcRenderer.removeListener(IPC.vizChanged, handler);
    },
  },
  video: {
    /** Build a streamable URL the <video> element can load for a given id. */
    url: (id: string): string => `${MEDIA_PROTOCOL}://${id}`,
    revealInFolder: (path: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.videoReveal, path),
  },
  app: {
    version: (): Promise<string> => ipcRenderer.invoke(IPC.appVersion),
  },
  updates: {
    onStatus: (cb: (state: UpdateState) => void): (() => void) => {
      const handler = (_e: unknown, state: UpdateState) => cb(state);
      ipcRenderer.on(IPC.updateStatus, handler);
      return () => ipcRenderer.removeListener(IPC.updateStatus, handler);
    },
    install: (): Promise<void> => ipcRenderer.invoke(IPC.updateInstall),
  },
};

contextBridge.exposeInMainWorld("api", api);

export type Api = typeof api;
