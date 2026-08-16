"use client";

import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { getFirebase } from "./firebase";
import type {
  CreateVisualizationRequest,
  CreateVisualizationResponse,
  Visualization,
} from "./types";

const COLLECTION = "visualizations";

function toVisualization(id: string, data: Record<string, unknown>): Visualization {
  return {
    id,
    ownerId: (data.ownerId as string) ?? "",
    topic: (data.topic as string) ?? "",
    title: (data.title as string) ?? "",
    description: (data.description as string) ?? "",
    status: (data.status as Visualization["status"]) ?? "queued",
    quality: (data.quality as Visualization["quality"]) ?? "m",
    manimCode: (data.manimCode as string) ?? null,
    sceneName: (data.sceneName as string) ?? null,
    videoPath: (data.videoPath as string) ?? null,
    videoUrl: (data.videoUrl as string) ?? null,
    durationSeconds: (data.durationSeconds as number) ?? null,
    error: (data.error as string) ?? null,
    createdAt: (data.createdAt as Visualization["createdAt"]) ?? null,
    updatedAt: (data.updatedAt as Visualization["updatedAt"]) ?? null,
  };
}

/** Live-subscribe to the current user's visualizations, newest first. */
export function subscribeToVisualizations(
  uid: string,
  onData: (items: Visualization[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const { db } = getFirebase();
  const q = query(
    collection(db, COLLECTION),
    where("ownerId", "==", uid),
    orderBy("createdAt", "desc"),
  );
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => toVisualization(d.id, d.data()))),
    (err) => onError?.(err),
  );
}

/** Live-subscribe to a single visualization document. */
export function subscribeToVisualization(
  id: string,
  onData: (item: Visualization | null) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const { db } = getFirebase();
  return onSnapshot(
    doc(db, COLLECTION, id),
    (snap) => onData(snap.exists() ? toVisualization(snap.id, snap.data()) : null),
    (err) => onError?.(err),
  );
}

/** Kick off a new visualization via the callable Cloud Function. */
export async function createVisualization(
  req: CreateVisualizationRequest,
): Promise<string> {
  const { functions } = getFirebase();
  const callable = httpsCallable<CreateVisualizationRequest, CreateVisualizationResponse>(
    functions,
    "createVisualization",
  );
  const res = await callable(req);
  return res.data.id;
}

export async function deleteVisualization(id: string): Promise<void> {
  const { db } = getFirebase();
  await deleteDoc(doc(db, COLLECTION, id));
}
