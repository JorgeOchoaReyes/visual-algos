# Manim render worker

A small Flask service that renders a stored Manim scene to an MP4 and uploads it
to Firebase Storage. Designed to run on **Google Cloud Run** because Manim needs
Python + ffmpeg + cairo/pango + LaTeX, which don't fit in plain Firebase
Functions.

## Endpoints

| Method | Path       | Notes                                              |
| ------ | ---------- | -------------------------------------------------- |
| POST   | `/render`  | Body `{ "visualizationId": "<id>" }`, header `X-Render-Token`. Returns `202` and renders in the background. |
| GET    | `/healthz` | Liveness check.                                    |

## Local development

```bash
cd render-worker
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt            # installs manim too (heavy)

# You also need the system deps locally: ffmpeg, cairo, pango, and (for MathTex)
# a LaTeX install. On macOS: `brew install ffmpeg cairo pango`. On Debian/Ubuntu:
# `sudo apt-get install ffmpeg libcairo2-dev libpango1.0-dev texlive`.

export RENDER_SHARED_SECRET=dev-secret
export RENDER_BUCKET=your-project-id.appspot.com
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
export PORT=8081
python main.py
```

The Cloud Function calls `http://127.0.0.1:8081/render` by default when
`RENDER_WORKER_URL` is unset, so the emulator + a local worker work together.

## Deploy to Cloud Run

```bash
# From render-worker/. Requires gcloud + a project with billing enabled.
PROJECT_ID=your-project-id
REGION=us-central1

gcloud run deploy manim-render-worker \
  --source . \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --no-allow-unauthenticated \
  --no-cpu-throttling \
  --cpu 2 --memory 2Gi \
  --timeout 900 \
  --set-env-vars "RENDER_BUCKET=${PROJECT_ID}.appspot.com,RENDER_TIMEOUT_SECONDS=600" \
  --set-secrets "RENDER_SHARED_SECRET=RENDER_SHARED_SECRET:latest"
```

Notes:

- **`--no-cpu-throttling`** is required: rendering happens in a background thread
  after the `202` response, so the instance must keep its CPU allocated.
- **`--no-allow-unauthenticated`** keeps the URL private. Grant the Cloud
  Function's service account the `roles/run.invoker` role on this service, or —
  simplest for an MVP — rely on the `X-Render-Token` shared secret and allow
  unauthenticated. The token check is enforced in `main.py` regardless.
- Give the service a dedicated service account with only **Firestore** and
  **Storage** access. That least-privilege boundary is the real containment for
  the AI-generated Python — the static denylist in `main.py` is only a first pass.
- After deploy, put the printed service URL into `functions/.env` as
  `RENDER_WORKER_URL` and redeploy the functions.

## Security model

The scene code comes from an LLM and is executed by `manim`. Mitigations:

1. **Static denylist** in both the Cloud Function and this worker rejects
   `os`, `subprocess`, `open`, `eval`, `exec`, sockets, etc.
2. **Isolation**: run this worker as its own least-privilege service account in
   its own Cloud Run service so a bad render can't reach anything else.
3. **Timeouts** bound runaway renders.

For stronger isolation, render inside gVisor/nsjail or a per-job sandbox. That's
a good follow-up but out of scope for the MVP.
