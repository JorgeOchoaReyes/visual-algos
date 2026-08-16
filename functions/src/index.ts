import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentDeleted } from "firebase-functions/v2/firestore";
import { defineSecret, defineString } from "firebase-functions/params";
import { logger } from "firebase-functions/v2";
import { generateManimScene } from "./gemini";
import { validateManimCode } from "./manimPrompt";
import type { CreateVisualizationData, RenderQuality } from "./types";

initializeApp();
const db = getFirestore();

// --- Configuration (secrets + params) ---------------------------------------
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const RENDER_SHARED_SECRET = defineSecret("RENDER_SHARED_SECRET");
const GEMINI_MODEL = defineString("GEMINI_MODEL", { default: "gemini-2.5-flash" });
const RENDER_WORKER_URL = defineString("RENDER_WORKER_URL", { default: "" });

const COLLECTION = "visualizations";
const LOCAL_WORKER_URL = "http://127.0.0.1:8081";

function normalizeQuality(q: unknown): RenderQuality {
  return q === "l" || q === "h" ? q : "m";
}

/**
 * Notify the render worker that a job is ready. The worker responds quickly
 * (202) and renders in the background, updating Firestore when done. We only
 * await the acknowledgement so this callable stays fast.
 */
async function triggerRender(visualizationId: string, sharedSecret: string): Promise<void> {
  const base = RENDER_WORKER_URL.value() || LOCAL_WORKER_URL;
  const url = `${base.replace(/\/$/, "")}/render`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Render-Token": sharedSecret,
    },
    body: JSON.stringify({ visualizationId }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Render worker returned ${res.status}: ${detail.slice(0, 200)}`);
  }
}

/**
 * createVisualization — the one endpoint the web app calls.
 * Auth required. Creates the job, asks Gemini for a Manim scene, stores it,
 * and kicks off rendering. Returns the new document id immediately so the
 * client can watch its status live in Firestore.
 */
export const createVisualization = onCall(
  {
    secrets: [GEMINI_API_KEY, RENDER_SHARED_SECRET],
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "You must be signed in.");
    }

    const data = (request.data ?? {}) as CreateVisualizationData;
    const topic = typeof data.topic === "string" ? data.topic.trim() : "";
    if (topic.length < 3 || topic.length > 500) {
      throw new HttpsError(
        "invalid-argument",
        "Topic must be between 3 and 500 characters.",
      );
    }
    const quality = normalizeQuality(data.quality);

    // 1. Create the job document up front so the UI has something to watch.
    const ref = db.collection(COLLECTION).doc();
    await ref.set({
      ownerId: uid,
      topic,
      quality,
      title: topic,
      description: "",
      status: "generating",
      manimCode: null,
      sceneName: null,
      videoPath: null,
      videoUrl: null,
      durationSeconds: null,
      error: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    try {
      // 2. Generate the Manim scene with Gemini.
      const scene = await generateManimScene(
        GEMINI_API_KEY.value(),
        GEMINI_MODEL.value(),
        topic,
      );

      // 3. Static safety check before anything gets executed downstream.
      const check = validateManimCode(scene);
      if (!check.ok) {
        throw new Error(check.reason || "Generated code failed validation.");
      }

      await ref.update({
        title: scene.title,
        description: scene.description,
        sceneName: scene.sceneName,
        manimCode: scene.code,
        status: "rendering",
        updatedAt: FieldValue.serverTimestamp(),
      });

      // 4. Hand off to the render worker.
      await triggerRender(ref.id, RENDER_SHARED_SECRET.value());

      return { id: ref.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Generation failed.";
      logger.error("createVisualization failed", { id: ref.id, message });
      await ref.update({
        status: "error",
        error: message,
        updatedAt: FieldValue.serverTimestamp(),
      });
      // Still return the id so the client can navigate and show the error.
      return { id: ref.id };
    }
  },
);

/**
 * When a visualization document is deleted by its owner, remove the rendered
 * video from Storage so we don't leak files.
 */
export const onVisualizationDeleted = onDocumentDeleted(
  `${COLLECTION}/{id}`,
  async (event) => {
    const data = event.data?.data();
    const videoPath = data?.videoPath as string | undefined;
    if (!videoPath) return;
    try {
      await getStorage().bucket().file(videoPath).delete({ ignoreNotFound: true });
    } catch (err) {
      logger.warn("Failed to delete video from storage", {
        videoPath,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  },
);
