export type RenderQuality = "l" | "m" | "h";

export type VisualizationStatus =
  | "generating" // Gemini is writing the Manim scene
  | "rendering" // manim is producing the MP4 locally
  | "ready" // video is on disk
  | "error";

export interface Visualization {
  id: string;
  topic: string;
  title: string;
  description: string;
  status: VisualizationStatus;
  quality: RenderQuality;
  manimCode: string | null;
  sceneName: string | null;
  /** Absolute path to the rendered mp4 on disk (once ready). */
  videoPath: string | null;
  durationSeconds: number | null;
  error: string | null;
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms
}

export interface CreateVisualizationInput {
  topic: string;
  quality: RenderQuality;
}

export interface Settings {
  geminiApiKey: string;
  geminiModel: string;
  /** Optional explicit path to a python interpreter (else auto-detected). */
  pythonPath: string;
}

export interface ToolStatus {
  ok: boolean;
  path: string | null;
  version: string | null;
  detail?: string;
}

export interface EnvStatus {
  python: ToolStatus;
  manim: ToolStatus;
  ffmpeg: ToolStatus;
  /** True when everything needed to render is present. */
  ready: boolean;
}

export const STATUS_LABELS: Record<VisualizationStatus, string> = {
  generating: "Writing scene",
  rendering: "Rendering video",
  ready: "Ready",
  error: "Failed",
};

export function isTerminal(status: VisualizationStatus): boolean {
  return status === "ready" || status === "error";
}

/** Channel names for IPC, kept in one place so main/preload agree. */
export const IPC = {
  settingsGet: "settings:get",
  settingsSet: "settings:set",
  envCheck: "env:check",
  envInstallManim: "env:install-manim",
  vizList: "viz:list",
  vizGet: "viz:get",
  vizCreate: "viz:create",
  vizDelete: "viz:delete",
  vizChanged: "viz:changed", // main -> renderer broadcast
  videoReveal: "video:reveal",
} as const;

export const MEDIA_PROTOCOL = "vizmedia";
