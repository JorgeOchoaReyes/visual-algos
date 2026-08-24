export type RenderQuality = "l" | "m" | "h";
export type Orientation = "landscape" | "portrait";

export const LANGUAGES: { id: string; label: string }[] = [
  { id: "python", label: "Python" },
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "java", label: "Java" },
  { id: "cpp", label: "C++" },
  { id: "c", label: "C" },
  { id: "go", label: "Go" },
  { id: "rust", label: "Rust" },
];

export const ORIENTATIONS: { id: Orientation; label: string; hint: string }[] = [
  { id: "landscape", label: "Landscape", hint: "16:9 · YouTube" },
  { id: "portrait", label: "Portrait", hint: "9:16 · Shorts/TikTok" },
];

/** What kind of video: a CS algorithm walkthrough, or an abstract concept. */
export type Mode = "algorithm" | "concept";

export const MODES: { id: Mode; label: string; hint: string; badge?: string }[] = [
  { id: "algorithm", label: "Algorithm", hint: "code + data structure" },
  { id: "concept", label: "Concept", hint: "social theory · abstract ideas", badge: "New!" },
];

export type VisualizationStatus =
  | "generating" // the model is writing the walkthrough spec
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
  /** Generated source lines joined for display. */
  manimCode: string | null;
  sceneName: string | null;
  /** Programming language of the generated code. */
  language: string;
  /** Algorithm walkthrough or abstract-concept animation (default algorithm). */
  mode: Mode;
  /** Whose account a concept video animates (e.g. "Marx, Capital Vol. I"). */
  tradition: string | null;
  /** Video aspect: landscape (16:9) or portrait (9:16). */
  orientation: Orientation;
  /** Absolute path to the rendered mp4 on disk (once ready). */
  videoPath: string | null;
  durationSeconds: number | null;
  /** Narration script (present when narration was requested). */
  narration: string | null;
  /** Whether narration was requested for this video (persisted for regenerate). */
  narrate: boolean;
  /** True once narration audio was synthesized and muxed into the video. */
  hasAudio: boolean;
  /** Non-fatal note (e.g. why narration didn't attach). */
  note: string | null;
  error: string | null;
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms
}

export interface CreateVisualizationInput {
  topic: string;
  quality: RenderQuality;
  /** Generate + mux an ElevenLabs voiceover (requires an ElevenLabs key). */
  narrate?: boolean;
  /** Programming language for the on-screen code (default python). */
  language?: string;
  /** Video aspect (default landscape). */
  orientation?: Orientation;
  /** Algorithm walkthrough or abstract-concept animation (default algorithm). */
  mode?: Mode;
}

export interface Settings {
  /** Which API the spec generation goes through. */
  provider: AiProvider;
  geminiApiKey: string;
  geminiModel: string;
  /** OpenRouter API key (used when provider is "openrouter"). */
  openRouterApiKey: string;
  /** OpenRouter model slug, e.g. "google/gemini-2.5-flash". */
  openRouterModel: string;
  /** Optional explicit path to a python interpreter (else auto-detected). */
  pythonPath: string;
  /** ElevenLabs API key for narration (optional). */
  elevenLabsApiKey: string;
  /** ElevenLabs voice id to narrate with. */
  elevenLabsVoiceId: string;
  /** ElevenLabs model id (quality vs. speed tier). */
  elevenLabsModel: string;
}

/** Where spec generation is sent. Both providers use a key you supply. */
export type AiProvider = "gemini" | "openrouter";

export const AI_PROVIDERS: { id: AiProvider; label: string; hint: string }[] = [
  { id: "gemini", label: "Google Gemini", hint: "free tier · aistudio.google.com" },
  { id: "openrouter", label: "OpenRouter", hint: "one key, many models" },
];

/** Suggested Gemini models for the Settings dropdown ("Custom…" allows any). */
export const GEMINI_MODELS: { id: string; label: string; note?: string }[] = [
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", note: "fast · recommended" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", note: "highest quality" },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
  { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
];

/**
 * A few OpenRouter slugs that reliably return strict JSON ("Custom…" allows
 * any). Any model works as long as it can follow the schema in the prompt.
 */
export const OPENROUTER_MODELS: { id: string; label: string; note?: string }[] = [
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", note: "fast · recommended" },
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", note: "highest quality" },
  { id: "openai/gpt-4o-mini", label: "GPT-4o mini", note: "cheap" },
  { id: "openai/gpt-4o", label: "GPT-4o" },
  { id: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
  { id: "deepseek/deepseek-chat", label: "DeepSeek Chat", note: "very cheap" },
  { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
];

/** The model id actually used for generation, given the settings. */
export function activeModel(settings: Pick<Settings, "provider" | "geminiModel" | "openRouterModel">): string {
  return settings.provider === "openrouter" ? settings.openRouterModel : settings.geminiModel;
}

/** Whether the selected provider has a key configured. */
export function hasProviderKey(settings: Pick<Settings, "provider" | "geminiApiKey" | "openRouterApiKey"> | null): boolean {
  if (!settings) return false;
  return settings.provider === "openrouter"
    ? !!settings.openRouterApiKey
    : !!settings.geminiApiKey;
}

export function providerLabel(provider: AiProvider): string {
  return AI_PROVIDERS.find((p) => p.id === provider)?.label ?? provider;
}

// --- Rough per-video cost estimate ------------------------------------------
// These are APPROXIMATE public API rates (USD) and change over time / vary by
// plan. They exist to give a ballpark, not a bill. Rendering is local = free.
const PRICING = {
  // $ per 1M tokens {input, output}. Pro tiers cost more than Flash tiers.
  geminiPro: { in: 1.25, out: 5.0 },
  geminiFlash: { in: 0.15, out: 0.6 },
  // OpenRouter resells hundreds of models at wildly different rates, so this
  // is a deliberately coarse mid-tier stand-in — see the note in the New page.
  openRouter: { in: 0.5, out: 1.5 },
  // Approx tokens used per generation attempt.
  tokensIn: 1500,
  tokensOut: 3500,
  // ElevenLabs: ~$ per 1k characters; a narration is ~650 chars.
  elevenPer1kChars: 0.15,
  narrationChars: 650,
};

function modelRate(provider: AiProvider, model: string): { in: number; out: number } {
  if (provider === "openrouter") {
    // OpenRouter marks no-cost variants with a ":free" suffix.
    if (/:free$/i.test(model)) return { in: 0, out: 0 };
    return PRICING.openRouter;
  }
  return /pro/i.test(model) ? PRICING.geminiPro : PRICING.geminiFlash;
}

export interface CostEstimate {
  /** Cost of the spec generation call itself (whichever provider). */
  model: number;
  narration: number;
  total: number;
}

/** Approximate cost for ONE generation attempt of a video. */
export function estimateVideoCost(
  provider: AiProvider,
  model: string,
  narrate: boolean,
): CostEstimate {
  const rate = modelRate(provider, model);
  const generation =
    (PRICING.tokensIn * rate.in + PRICING.tokensOut * rate.out) / 1_000_000;
  const narration = narrate
    ? (PRICING.narrationChars / 1000) * PRICING.elevenPer1kChars
    : 0;
  return { model: generation, narration, total: generation + narration };
}

/** Format a small dollar amount for display (e.g. "$0.002", "<$0.001"). */
export function formatUsd(n: number): string {
  if (n <= 0) return "$0";
  if (n < 0.001) return "<$0.001";
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

/** A few well-known public ElevenLabs voices ("Custom…" allows any id). */
export const ELEVENLABS_VOICES: { id: string; label: string }[] = [
  { id: "21m00Tcm4TlvDq8ikWAM", label: "Rachel (calm, narration)" },
  { id: "AZnzlk1XvdvUeBnXmlld", label: "Domi (confident)" },
  { id: "EXAVITQu4vr4xnSDxMaL", label: "Bella (soft)" },
  { id: "TxGEqnHWrfWFTfGW9XjX", label: "Josh (deep)" },
  { id: "VR6AewLTigWG4xSOukaG", label: "Arnold (crisp)" },
  { id: "pNInz6obpgDQGcFmaJgB", label: "Adam (narration)" },
];

/** ElevenLabs model tiers ("Custom…" allows any model id). */
export const ELEVENLABS_MODELS: { id: string; label: string; note?: string }[] = [
  { id: "eleven_multilingual_v2", label: "Multilingual v2", note: "best quality · recommended" },
  { id: "eleven_turbo_v2_5", label: "Turbo v2.5", note: "faster · lower cost" },
  { id: "eleven_flash_v2_5", label: "Flash v2.5", note: "fastest · lowest latency" },
  { id: "eleven_monolingual_v1", label: "Monolingual v1", note: "English only (legacy)" },
];

export const DEFAULT_ELEVENLABS_MODEL = "eleven_multilingual_v2";

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
  vizRegenerate: "viz:regenerate",
  appVersion: "app:version",
  vizChanged: "viz:changed", // main -> renderer broadcast
  videoReveal: "video:reveal",
  updateStatus: "update:status", // main -> renderer broadcast
  updateInstall: "update:install",
  setupStatus: "setup:status", // main -> renderer broadcast
  setupRetry: "setup:retry",
} as const;

export type SetupState =
  | { phase: "checking" }
  | { phase: "installing"; message?: string; log?: string }
  | { phase: "ready" }
  | { phase: "error"; message?: string };

export type UpdateState =
  | { status: "checking" }
  | { status: "available"; version?: string }
  | { status: "downloading"; percent?: number }
  | { status: "ready"; version?: string }
  | { status: "none" }
  | { status: "error"; message?: string };

export const MEDIA_PROTOCOL = "vizmedia";
