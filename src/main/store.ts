import { existsSync, readFileSync, writeFileSync, renameSync } from "fs";
import { DEFAULT_ELEVENLABS_MODEL, type Settings, type Visualization } from "@shared/types";
import { getPaths } from "./paths";

const DEFAULT_SETTINGS: Settings = {
  provider: "gemini",
  geminiApiKey: "",
  geminiModel: "gemini-2.5-flash",
  openRouterApiKey: "",
  openRouterModel: "google/gemini-2.5-flash",
  pythonPath: "",
  elevenLabsApiKey: "",
  elevenLabsVoiceId: "21m00Tcm4TlvDq8ikWAM",
  elevenLabsModel: DEFAULT_ELEVENLABS_MODEL,
};

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

/** Atomic-ish write: write to a temp file then rename over the target. */
function writeJson(file: string, data: unknown): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmp, file);
}

// --- Settings ---------------------------------------------------------------

export function getSettings(): Settings {
  const { settingsFile } = getPaths();
  const stored = readJson<Partial<Settings>>(settingsFile, {});
  const settings = { ...DEFAULT_SETTINGS, ...stored };
  // Settings written before OpenRouter support have no provider field.
  if (settings.provider !== "openrouter") settings.provider = "gemini";
  return settings;
}

export function setSettings(patch: Partial<Settings>): Settings {
  const { settingsFile } = getPaths();
  const next = { ...getSettings(), ...patch };
  writeJson(settingsFile, next);
  return next;
}

// --- Visualization library --------------------------------------------------

interface Library {
  visualizations: Visualization[];
}

function readLibrary(): Library {
  const { libraryFile } = getPaths();
  const lib = readJson<Library>(libraryFile, { visualizations: [] });
  if (!Array.isArray(lib.visualizations)) return { visualizations: [] };
  return lib;
}

function writeLibrary(lib: Library): void {
  const { libraryFile } = getPaths();
  writeJson(libraryFile, lib);
}

export function listVisualizations(): Visualization[] {
  return readLibrary().visualizations.sort((a, b) => b.createdAt - a.createdAt);
}

export function getVisualization(id: string): Visualization | null {
  return readLibrary().visualizations.find((v) => v.id === id) ?? null;
}

export function upsertVisualization(viz: Visualization): void {
  const lib = readLibrary();
  const idx = lib.visualizations.findIndex((v) => v.id === viz.id);
  if (idx >= 0) lib.visualizations[idx] = viz;
  else lib.visualizations.push(viz);
  writeLibrary(lib);
}

/**
 * Apply a partial update to a stored visualization and persist it. Returns the
 * updated record (or null if it no longer exists).
 */
export function patchVisualization(
  id: string,
  patch: Partial<Visualization>,
): Visualization | null {
  const lib = readLibrary();
  const idx = lib.visualizations.findIndex((v) => v.id === id);
  if (idx < 0) return null;
  const updated = { ...lib.visualizations[idx], ...patch, updatedAt: Date.now() };
  lib.visualizations[idx] = updated;
  writeLibrary(lib);
  return updated;
}

export function deleteVisualization(id: string): void {
  const lib = readLibrary();
  lib.visualizations = lib.visualizations.filter((v) => v.id !== id);
  writeLibrary(lib);
}
