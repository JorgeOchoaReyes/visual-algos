"""Manim render worker.

A tiny Flask service that turns a stored Manim scene into an MP4:

  POST /render  { "visualizationId": "<id>" }   (header X-Render-Token: <secret>)

Flow:
  1. Authenticate the request via the shared secret.
  2. Respond 202 immediately and render in a background thread (Cloud Run must be
     deployed with CPU always allocated: `--no-cpu-throttling`).
  3. Read the scene from Firestore, run `manim` to produce an MP4.
  4. Upload the video to Firebase Storage and flip the doc's status to "ready"
     (or "error").

The generated Python is arbitrary code, so we run a defensive static scan before
executing it. This is a guardrail — deploy the worker isolated (its own service
account, no extra IAM), which is the real containment boundary. See README.
"""

from __future__ import annotations

import glob
import os
import re
import subprocess
import tempfile
import threading
import traceback
import uuid
from datetime import datetime, timezone

import firebase_admin
from firebase_admin import credentials, firestore, storage
from flask import Flask, jsonify, request

# --- Config -----------------------------------------------------------------
SHARED_SECRET = os.environ.get("RENDER_SHARED_SECRET", "")
STORAGE_BUCKET = os.environ.get("RENDER_BUCKET", "")  # e.g. my-project.appspot.com
RENDER_TIMEOUT_SECONDS = int(os.environ.get("RENDER_TIMEOUT_SECONDS", "600"))
COLLECTION = "visualizations"

QUALITY_FLAG = {"l": "-ql", "m": "-qm", "h": "-qh"}

# Same denylist as the Cloud Function, enforced again here (defense in depth).
DENYLIST = [
    r"\bimport\s+os\b",
    r"\bimport\s+sys\b",
    r"\bimport\s+subprocess\b",
    r"\bimport\s+socket\b",
    r"\bimport\s+shutil\b",
    r"\bimport\s+requests\b",
    r"\bimport\s+urllib\b",
    r"\bimport\s+pathlib\b",
    r"\bfrom\s+os\b",
    r"\bfrom\s+subprocess\b",
    r"\b__import__\s*\(",
    r"\beval\s*\(",
    r"\bexec\s*\(",
    r"\bopen\s*\(",
    r"\bcompile\s*\(",
]

# --- Firebase init ----------------------------------------------------------
_app_options = {"storageBucket": STORAGE_BUCKET} if STORAGE_BUCKET else None
if not firebase_admin._apps:
    # On Cloud Run, application-default credentials are used automatically.
    firebase_admin.initialize_app(credentials.ApplicationDefault(), _app_options)

db = firestore.client()
app = Flask(__name__)


def _now():
    return datetime.now(timezone.utc)


def _is_code_safe(code: str) -> bool:
    return not any(re.search(p, code) for p in DENYLIST)


def _set_error(viz_id: str, message: str) -> None:
    db.collection(COLLECTION).document(viz_id).update(
        {"status": "error", "error": message[:800], "updatedAt": _now()}
    )


def _probe_duration(path: str) -> float | None:
    """Best-effort video duration via ffprobe (ships with the manim image)."""
    try:
        out = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        return round(float(out.stdout.strip()), 2)
    except Exception:
        return None


def _render(viz_id: str) -> None:
    """Do the actual work. Runs in a background thread."""
    try:
        snap = db.collection(COLLECTION).document(viz_id).get()
        if not snap.exists:
            return
        data = snap.to_dict() or {}

        owner_id = data.get("ownerId")
        code = data.get("manimCode")
        scene_name = data.get("sceneName")
        quality = data.get("quality", "m")

        if not owner_id or not code or not scene_name:
            _set_error(viz_id, "Job is missing code, scene name, or owner.")
            return
        if not _is_code_safe(code):
            _set_error(viz_id, "Generated code failed the safety check.")
            return
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", scene_name):
            _set_error(viz_id, "Invalid scene name.")
            return

        flag = QUALITY_FLAG.get(quality, "-qm")

        with tempfile.TemporaryDirectory() as workdir:
            script_path = os.path.join(workdir, "scene.py")
            media_dir = os.path.join(workdir, "media")
            with open(script_path, "w", encoding="utf-8") as f:
                f.write(code)

            cmd = [
                "manim",
                "render",
                flag,
                "--media_dir",
                media_dir,
                "--format",
                "mp4",
                script_path,
                scene_name,
            ]
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=RENDER_TIMEOUT_SECONDS,
                cwd=workdir,
            )
            if proc.returncode != 0:
                tail = (proc.stderr or proc.stdout or "").strip()[-800:]
                _set_error(viz_id, f"Manim render failed:\n{tail}")
                return

            matches = glob.glob(os.path.join(media_dir, "**", "*.mp4"), recursive=True)
            if not matches:
                _set_error(viz_id, "Render produced no video file.")
                return
            # Prefer the file whose name matches the scene.
            matches.sort(key=lambda p: (scene_name not in os.path.basename(p), len(p)))
            video_path = matches[0]
            duration = _probe_duration(video_path)

            # Upload to Storage with a Firebase download token.
            object_path = f"videos/{owner_id}/{viz_id}.mp4"
            bucket = storage.bucket()
            blob = bucket.blob(object_path)
            token = str(uuid.uuid4())
            blob.metadata = {"firebaseStorageDownloadTokens": token}
            blob.upload_from_filename(video_path, content_type="video/mp4")

            bucket_name = bucket.name
            encoded = object_path.replace("/", "%2F")
            download_url = (
                f"https://firebasestorage.googleapis.com/v0/b/{bucket_name}"
                f"/o/{encoded}?alt=media&token={token}"
            )

            db.collection(COLLECTION).document(viz_id).update(
                {
                    "status": "ready",
                    "videoPath": object_path,
                    "videoUrl": download_url,
                    "durationSeconds": duration,
                    "error": None,
                    "updatedAt": _now(),
                }
            )
    except subprocess.TimeoutExpired:
        _set_error(viz_id, "Rendering timed out.")
    except Exception as exc:  # noqa: BLE001 — report everything back to the user
        traceback.print_exc()
        _set_error(viz_id, f"Unexpected render error: {exc}")


@app.post("/render")
def render_endpoint():
    if not SHARED_SECRET or request.headers.get("X-Render-Token") != SHARED_SECRET:
        return jsonify({"error": "unauthorized"}), 401

    body = request.get_json(silent=True) or {}
    viz_id = body.get("visualizationId")
    if not viz_id or not isinstance(viz_id, str):
        return jsonify({"error": "visualizationId is required"}), 400

    # Kick off rendering in the background and acknowledge immediately.
    threading.Thread(target=_render, args=(viz_id,), daemon=True).start()
    return jsonify({"status": "accepted", "id": viz_id}), 202


@app.get("/healthz")
def healthz():
    return jsonify({"status": "ok"}), 200


if __name__ == "__main__":
    # Local dev entrypoint. In production gunicorn serves the app (see Dockerfile).
    port = int(os.environ.get("PORT", "8081"))
    app.run(host="0.0.0.0", port=port)
