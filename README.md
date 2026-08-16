# Visual Algos

Type a computer-science topic → get a **3Blue1Brown-style [Manim](https://www.manim.community/) video**
that explains it. AI ([Gemini](https://ai.google.dev/)) writes the animation, a
render worker turns it into a real MP4, and it's saved to your library.

```
┌─────────────┐   createVisualization    ┌──────────────────┐   Gemini    ┌──────────┐
│  Next.js    │ ───────(callable)──────▶ │ Firebase Function │ ──────────▶ │  Gemini  │
│  web app    │                          │  (Node / TS)      │ ◀────────── │   API    │
│             │                          └────────┬─────────┘   scene code └──────────┘
│  Firebase   │                                   │ POST /render (shared secret)
│  Auth       │                                   ▼
│             │                          ┌──────────────────┐   manim → mp4
│  watches    │ ◀── Firestore (live) ──▶ │  Render worker    │ ──────────────┐
│  Firestore  │                          │ (Python + Manim,  │               ▼
└─────────────┘                          │  Cloud Run)       │        ┌──────────────┐
       ▲                                 └──────────────────┘         │   Firebase   │
       └──────────────── video URL ◀──────── updates doc ◀────────────│   Storage    │
                                                                      └──────────────┘
```

## What's in here

| Path            | What it is                                                        |
| --------------- | ----------------------------------------------------------------- |
| `web/`          | Next.js 14 (App Router) + Tailwind front end. Firebase Auth, a gallery, a "new video" form, and a live-updating video page. |
| `functions/`    | Firebase Functions (v2, TypeScript). `createVisualization` callable: validates input, calls Gemini for a Manim scene, writes the Firestore job, and triggers the render worker. |
| `render-worker/`| Python Flask + Manim service (Docker → Cloud Run). Renders the scene to MP4, uploads to Storage, flips the job to `ready`. |
| `firestore.rules`, `storage.rules` | Owner-only access; only the backend (Admin SDK) writes data and videos. |
| `firebase.json`, `firestore.indexes.json` | Firebase project + emulator config. |

## How a request flows

1. User signs in (Firebase Auth) and submits a topic on `/new`.
2. `createVisualization` (Cloud Function) creates a `visualizations/{id}` doc with
   status `generating`, calls **Gemini** to write a self-contained Manim scene,
   runs a **static safety scan** on the code, stores it, and flips status to
   `rendering`.
3. The function POSTs the job id to the **render worker** (authenticated by a
   shared secret). The worker renders with `manim`, uploads the MP4 to Storage,
   and sets status `ready` with a video URL — or `error` with a message.
4. The web app is subscribed to the Firestore doc, so the page updates live from
   *Writing scene → Rendering → Ready* and then plays the video.

## Prerequisites

- Node.js 20+
- A Firebase project (Blaze/pay-as-you-go plan — required for Cloud Functions +
  Cloud Run). Enable **Authentication** (Google provider), **Firestore**, and
  **Storage** in the console.
- A **Gemini API key** from [Google AI Studio](https://aistudio.google.com/apikey).
- `firebase-tools`: `npm install -g firebase-tools` and `firebase login`.
- For the render worker: `gcloud` CLI (deploy) and/or Docker + local system deps.

## Setup

```bash
# 1. Install everything
npm run install:all            # root, web/, functions/

# 2. Point the repo at your Firebase project
cp .firebaserc.example .firebaserc      # then edit the project id

# 3. Configure the web app
cp web/.env.local.example web/.env.local   # fill in Firebase web config

# 4. Configure the functions
cp functions/.env.example functions/.env   # GEMINI_API_KEY, RENDER_SHARED_SECRET, ...

# 5. Configure the render worker (for deploy)
cp render-worker/.env.example render-worker/.env
```

### Run locally (emulators)

```bash
# Terminal A — Firebase emulators (auth, firestore, functions, storage)
npm run emulators

# Terminal B — the render worker (see render-worker/README.md for system deps)
cd render-worker && python main.py         # listens on :8081

# Terminal C — the web app, pointed at the emulators
#   set NEXT_PUBLIC_USE_EMULATORS=true in web/.env.local first
npm run dev                                 # http://localhost:3000
```

With emulators, the function calls the local worker at `http://127.0.0.1:8081`
automatically (no `RENDER_WORKER_URL` needed).

> Rendering locally requires Manim's system dependencies (ffmpeg, cairo, pango,
> LaTeX). If you don't want to install those, deploy the render worker to Cloud
> Run and set `RENDER_WORKER_URL` instead.

### Deploy

```bash
# 1. Render worker → Cloud Run (prints a service URL). See render-worker/README.md.
cd render-worker && gcloud run deploy manim-render-worker --source . ...

# 2. Put the service URL in functions/.env as RENDER_WORKER_URL, then:
cd ..
firebase deploy --only firestore:rules,storage         # security rules
firebase deploy --only functions                       # Cloud Functions

# 3. Web app — deploy to Firebase Hosting, Vercel, or any Node host.
npm run build:web
```

Set the two secrets in Google Secret Manager (or Functions config) so they're
available at runtime:

```bash
firebase functions:secrets:set GEMINI_API_KEY
firebase functions:secrets:set RENDER_SHARED_SECRET
```

(The same `RENDER_SHARED_SECRET` value must be set on the Cloud Run worker.)

## Data model — `visualizations/{id}`

| Field             | Type     | Notes                                             |
| ----------------- | -------- | ------------------------------------------------- |
| `ownerId`         | string   | Firebase Auth uid. Enforced by rules.             |
| `topic`           | string   | The user's prompt.                                |
| `title`, `description` | string | Generated by Gemini.                         |
| `status`          | string   | `generating` → `rendering` → `ready` / `error`.   |
| `quality`         | string   | `l` \| `m` \| `h` (Manim quality).                |
| `manimCode`       | string   | Generated scene source.                           |
| `sceneName`       | string   | Scene class to render.                            |
| `videoPath`       | string   | Storage object path.                              |
| `videoUrl`        | string   | Tokenized download URL.                           |
| `durationSeconds` | number   | Probed from the MP4.                              |
| `error`           | string   | Present when `status === "error"`.                |
| `createdAt`, `updatedAt` | timestamp | Server timestamps.                        |

## Security notes

- Clients never write `visualizations` docs or upload videos directly — the
  Admin SDK (Function + worker) is the only writer. Rules enforce owner-only
  read/delete. See `firestore.rules` / `storage.rules`.
- AI-generated Python is scanned against a denylist **before** it runs, in both
  the Function and the worker. Run the worker as a least-privilege service
  account in its own Cloud Run service for real isolation — details in
  `render-worker/README.md`.

## Roadmap ideas

- Narration/voiceover (TTS) synced to scene sections.
- Regenerate / edit-the-code-and-re-render.
- Public share links and a gallery of examples.
- Stronger per-render sandboxing (gVisor/nsjail).
