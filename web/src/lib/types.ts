export type VisualizationStatus =
  | "queued" // job created, waiting to start
  | "generating" // Gemini is writing the Manim scene
  | "rendering" // render worker is producing the MP4
  | "ready" // video is available
  | "error"; // something failed

export type RenderQuality = "l" | "m" | "h"; // Manim: low / medium / high

export interface Visualization {
  id: string;
  ownerId: string;
  topic: string;
  title: string;
  description: string;
  status: VisualizationStatus;
  quality: RenderQuality;
  /** Generated Manim Python source (available once status >= "rendering"). */
  manimCode: string | null;
  /** Name of the Scene subclass Manim should render. */
  sceneName: string | null;
  /** Firebase Storage object path, e.g. videos/{uid}/{id}.mp4 */
  videoPath: string | null;
  /** Publicly-fetchable (token'd) download URL for the rendered video. */
  videoUrl: string | null;
  durationSeconds: number | null;
  /** Human-readable error when status === "error". */
  error: string | null;
  createdAt: FirestoreTimestampLike | null;
  updatedAt: FirestoreTimestampLike | null;
}

/** Minimal shape we rely on from a Firestore Timestamp on the client. */
export interface FirestoreTimestampLike {
  seconds: number;
  nanoseconds: number;
}

/** Payload accepted by the `createVisualization` callable function. */
export interface CreateVisualizationRequest {
  topic: string;
  quality?: RenderQuality;
}

export interface CreateVisualizationResponse {
  id: string;
}

export const STATUS_LABELS: Record<VisualizationStatus, string> = {
  queued: "Queued",
  generating: "Writing scene",
  rendering: "Rendering video",
  ready: "Ready",
  error: "Failed",
};

export function isTerminal(status: VisualizationStatus): boolean {
  return status === "ready" || status === "error";
}
