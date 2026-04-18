# Cricket Batting Analysis

Analyses cricket batting technique from iPhone videos shot from the bowler's end.
Upload a video, get a skeleton-overlay replay, biomechanical metrics, and optional
AI coaching feedback from Claude. Chat with the AI to discuss the technique or
correct misidentified shots and trigger a re-analysis.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser / iPhone                        │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │               Vite + React + TypeScript                   │  │
│  │                                                           │  │
│  │  LibraryView ──► VideoDetailView ──► ChatPanel           │  │
│  │       │                │                  │              │  │
│  │  UploadView      AnalysisPanel       ConvSelector        │  │
│  └──────────────────────────────────────────────────────────┘  │
│               │ HTTP / REST (port 3009 → proxy → 8082)         │
└───────────────┼─────────────────────────────────────────────────┘
                │
                ▼
┌──────────────────────────────┐
│   FastAPI Backend  (:8082)   │
│                              │
│  /api/videos      (library)  │
│  /api/videos/.../analyses    │
│  /api/videos/.../convs       │
│  /api/jobs        (legacy)   │
│  /health                     │
└──────────┬───────────────────┘
           │ enqueue_job (arq)
           ▼
┌──────────────────────────────┐     ┌──────────────────────┐
│   Redis  (:6382)             │◄────│  arq Worker          │
│   Job queue + results        │     │                      │
└──────────────────────────────┘     │  pipeline stages:    │
                                     │  1. ingest           │
                                     │  2. normalize        │
                                     │  3. pose             │
                                     │  4. metrics          │
                                     │  5. render           │
                                     │  6. llm (optional)   │
                                     └──────────┬───────────┘
                                                │
                                     ┌──────────▼───────────┐
                                     │  Anthropic API       │
                                     │  (Claude Haiku +     │
                                     │   Claude Sonnet)     │
                                     └──────────────────────┘
```

---

## Video Pipeline

```
Upload (.mov / .mp4)
        │
        ▼
  ┌─────────────┐
  │   Ingest    │  Save original, create library entry
  └──────┬──────┘
         │
         ▼
  ┌─────────────┐
  │  Normalize  │  ffmpeg → H.264 CFR, fix iPhone rotation, ≤1080p
  └──────┬──────┘
         │
         ▼
  ┌─────────────┐
  │    Pose     │  MediaPipe PoseLandmarker (Tasks API v0.10)
  │ Estimation  │  33 landmarks × every frame → keypoints.jsonl
  └──────┬──────┘
         │
         ▼
  ┌─────────────┐
  │   Metrics   │  Stance width, head stillness, backlift height,
  │             │  stride length, head-over-foot → analysis.json
  └──────┬──────┘
         │
         ▼
  ┌─────────────┐
  │   Render    │  OpenCV skeleton overlay → ffmpeg → annotated.mp4
  └──────┬──────┘
         │
         ▼
  ┌─────────────┐   (skipped if ANTHROPIC_API_KEY not set)
  │  LLM Layer  │
  │             │  Claude Haiku  → coaching feedback (metrics → text)
  │             │  Claude Sonnet → shot classification (pose trajectory)
  │             │  Claude Sonnet → vision review (3 JPEG key frames)
  └──────┬──────┘
         │
         ▼
     complete
```

---

## Library & Chat Architecture

```
data/library/
└── {video_id}/
    ├── meta.json               # filename, created_at
    ├── original.mp4            # preserved upload
    ├── analyses/
    │   └── {analysis_id}/
    │       ├── status.json     # stage, progress, error
    │       ├── normalized.mp4
    │       ├── keypoints.jsonl
    │       ├── analysis.json   # StanceMetrics
    │       ├── insights.json   # LLM outputs
    │       ├── annotated.mp4
    │       ├── llm_log.jsonl
    │       └── key_frames/
    │           ├── start_of_backlift.jpg
    │           ├── top_of_backlift.jpg
    │           └── mid_shot.jpg
    └── conversations/
        └── {conv_id}.jsonl     # JSONL: meta + messages
```

Chat flow:

```
User message
     │
     ▼
ChatPanel (React)
     │  POST /api/videos/{id}/conversations/{cid}/messages
     ▼
video_routes.py
     │  loads analysis context (metrics + insights)
     ▼
chat_agent.py  (Claude Sonnet)
     │  system prompt includes full video context
     │  parses <ACTION:REANALYZE> and <CORRECTION:key=value> tokens
     ▼
  ┌──────────────────────────────────────────────────┐
  │  if action == "reanalyze":                       │
  │    create_analysis() → enqueue_job(corrections)  │
  │    frontend switches to new analysis + polls      │
  └──────────────────────────────────────────────────┘
     │
     ▼
response: { reply, action, corrections, triggered_analysis_id }
```

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Python | ≥ 3.11 | system / conda |
| uv | latest | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Node.js | ≥ 18 | nvm / system |
| ffmpeg | ≥ 6 | `conda install -c conda-forge ffmpeg` |
| Redis | ≥ 7 | `conda install -c conda-forge redis` |

Check for port conflicts before setting `.env`:
```bash
ss -tlnp | grep -E '8082|3009|6382'
```

---

## Configuration

Copy `.env.example` to `.env` and edit:

```bash
cp .env.example .env
```

```ini
# Ports (change if clashing with existing services)
BACKEND_PORT=8082
FRONTEND_PORT=3009
REDIS_PORT=6382
REDIS_HOST=localhost

# Leave blank to run without LLM insights
ANTHROPIC_API_KEY=sk-ant-...

# Absolute path recommended to avoid CWD ambiguity
DATA_DIR=/absolute/path/to/this/repo/data

WORKER_CONCURRENCY=2
```

**Never commit `.env`** — it is in `.gitignore`. Only `.env.example` is tracked.

---

## Quick Start

```bash
# Clone and enter repo
git clone <repo-url>
cd cricket-batting-analysis

# Configure
cp .env.example .env
# edit .env — set ports, DATA_DIR (absolute), and optionally ANTHROPIC_API_KEY

# Install frontend deps
cd frontend && npm install && cd ..

# Install backend deps
cd backend && uv sync && cd ..

# Start everything (Redis + backend + worker + frontend in background)
bash scripts/start.sh

# Open browser
open http://localhost:3009   # or navigate manually
```

### Stop

```bash
bash scripts/stop.sh
```

Logs are written to `logs/`:

| File | Contents |
|------|----------|
| `logs/backend.log` | FastAPI request/response + pipeline events |
| `logs/worker.log` | arq job progress, LLM calls, errors |
| `logs/redis.log` | Redis server output |
| `logs/backend-uvicorn.log` | uvicorn stderr |
| `logs/worker-arq.log` | arq stderr |
| `logs/frontend.log` | Vite dev server |

---

## Using the App

### Upload & Analyse
1. Click **+ Upload** in the header
2. Drop or tap to select a `.mov` / `.mp4` shot from the bowler's end
3. The app navigates to the video detail page and polls for progress
4. When complete: watch the skeleton-overlay video, browse Metrics and AI Insights tabs

### Library
- All uploaded videos are preserved in the **Library** view
- Click any video to return to its detail page
- Each video retains full analysis history — old analyses are never deleted unless you explicitly remove them

### Re-analysis
- Click **Re-run Analysis** on the detail page to run a fresh analysis (e.g. after marking the impact frame)
- The chat agent can also trigger re-analysis with corrections (e.g. corrected shot type)

### Chat
- Open the **Chat** panel on any video detail page
- Ask questions about the metrics, coaching feedback, or technique
- Say _"re-analyse"_ (or similar) to trigger a new analysis job with your corrections
- Multiple conversations are supported per video; each is preserved in the library

### Dark / Light Mode
- Click ☀️ / 🌙 in the header to toggle; preference is saved to `localStorage`

---

## API Reference

Interactive docs at **http://localhost:8082/docs**

### Library endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/videos` | Upload video → `{video_id, analysis_id}` |
| `GET` | `/api/videos` | List all videos with analyses and conversation counts |
| `GET` | `/api/videos/{id}` | Video detail including full analysis list |
| `DELETE` | `/api/videos/{id}` | Delete video and all its data |
| `POST` | `/api/videos/{id}/analyses` | Re-run analysis (body: `{corrections}`) |
| `GET` | `/api/videos/{id}/analyses/{aid}` | Analysis status, metrics, insights |
| `DELETE` | `/api/videos/{id}/analyses/{aid}` | Delete one analysis |
| `GET` | `/api/videos/{id}/analyses/{aid}/video` | Stream annotated MP4 (range requests) |
| `POST` | `/api/videos/{id}/analyses/{aid}/impact` | Mark impact frame `{frame_index}` |
| `GET` | `/api/videos/{id}/conversations` | List conversations |
| `POST` | `/api/videos/{id}/conversations` | Create conversation |
| `GET` | `/api/videos/{id}/conversations/{cid}` | Get conversation with messages |
| `PATCH` | `/api/videos/{id}/conversations/{cid}` | Rename conversation |
| `DELETE` | `/api/videos/{id}/conversations/{cid}` | Delete conversation |
| `POST` | `/api/videos/{id}/conversations/{cid}/messages` | Send chat message |

### Legacy job endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/jobs` | Upload (legacy) → `{job_id}` |
| `GET` | `/api/jobs/{id}` | Poll job status |
| `GET` | `/api/jobs/{id}/video` | Stream annotated video |
| `POST` | `/api/jobs/{id}/impact` | Mark impact frame |
| `POST` | `/api/jobs/{id}/feedback` | Thumbs up/down on an insight |
| `GET` | `/health` | Health check |

---

## LLM Models

| Task | Model | Why |
|------|-------|-----|
| Coaching feedback | `claude-haiku-4-5-20251001` | Fast, numeric metrics → text |
| Shot classification | `claude-sonnet-4-6` | Needs trajectory reasoning |
| Vision review | `claude-sonnet-4-6` | Multi-image input, complex frame analysis |
| Chat agent | `claude-sonnet-4-6` | Conversational, correction parsing |

---

## End-to-End Tests

```bash
cd backend
uv sync

# Without API key (deterministic pipeline only)
python ../tests/test_e2e.py

# With LLM insights
ANTHROPIC_API_KEY=sk-ant-... python ../tests/test_e2e.py

# Against a real video
VIDEO_PATH=/path/to/batting.mov python ../tests/test_e2e.py
```

A synthetic 5-second video is generated automatically when `VIDEO_PATH` is not set.

---

## Docker (optional)

`docker-compose.yml` is included for containerised deployments.
Install Docker + optionally `nvidia-container-toolkit` for GPU, then:

```bash
cp .env.example .env  # edit as above
docker compose up --build
```

The frontend still runs via `bash scripts/start.sh` (Vite dev server is not containerised).

---

## Known Limitations

- **Pose accuracy at distance**: MediaPipe is optimised for close-up portrait capture. Bowler's-end footage at 20–30 m with good lighting works best; partial occlusion or poor lighting reduces landmark confidence.
- **Single batter assumption**: If the bowler is visible in frame, their landmarks may be mixed into the metrics.
- **30 fps hardcoded**: The "Mark Impact Frame" button derives frame numbers at 30 fps. Adjust the constant in `ResultsView` / `VideoDetailView` for other frame rates.
- **No bat tracking**: v1 is pose-only. Bat speed, angle, and ball trajectory are not computed.
- **Re-analysis reruns full pipeline**: Corrections from chat trigger a complete re-run (pose → metrics → LLM). There is no partial update.

---

## Security Notes

- **File uploads**: only `.mov` and `.mp4` extensions are accepted; the filename is discarded (only the extension is used when saving). Consider adding a file-size cap and magic-byte validation for production use.
- **API key**: stored only in `.env` (gitignored). Never logged or returned to the client.
- **No authentication**: the API has no auth layer — suitable for local / LAN use only. Add an API gateway or auth middleware before exposing publicly.
