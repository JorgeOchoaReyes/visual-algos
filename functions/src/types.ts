export type RenderQuality = "l" | "m" | "h";

export type VisualizationStatus =
  | "queued"
  | "generating"
  | "rendering"
  | "ready"
  | "error";

/** Structured result we ask Gemini to return. */
export interface GeneratedScene {
  title: string;
  description: string;
  sceneName: string;
  code: string;
}

export interface CreateVisualizationData {
  topic?: unknown;
  quality?: unknown;
}
