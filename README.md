# Cricket Batting Analysis

Analyses cricket batting technique from iPhone videos shot from the bowler's
end. Runs pose estimation on every frame, computes biomechanical metrics, and
(optionally) generates AI coaching insights via Claude.

---

## Ports

| Service | Port |
|---------|------|
| Backend API | **8082** |
| Frontend | **3009** |
| Redis | **6382** |

Ports were chosen by running `ss -tlnp` on this machine and selecting unused
ones. Edit `.env` if those ports are now taken.

---

## Prerequisites

```bash
# ffmpeg and redis (via conda-forge if not installed)
conda install -c conda-forge ffmpeg redis -y

# uv (Python package manager)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Node.js >= 18 (NVM recommended)
# Already present at v20.20.2
```

---

## Quick Start (native — no Docker)

Open four terminals in the repo root.

**Terminal 1 — Redis:**
```bash
bash scripts/start-redis.sh
```

**Terminal 2 — Backend API:**
```bash
cd backend
~/.local/bin/uv sync
bash ../scripts/start-backend.sh
```

**Terminal 3 — Worker:**
```bash
bash scripts/start-worker.sh
```

**Terminal 4 — Frontend:**
```bash
bash scripts/start-frontend.sh
```

Then open **http://localhost:3009** in your browser.

---

## Providing the Anthropic API Key

Add it to `.env` (never commit this):
```
ANTHROPIC_API_KEY=sk-ant-...
```

With the key set, the pipeline runs:
- **Claude Haiku** — coaching feedback (strengths, issues, drills)
- **Claude Sonnet** — shot classification + vision frame review

Without the key, the deterministic pipeline (pose + metrics + annotated video)
still runs fully. The Coaching and Shot tabs are hidden in the UI.

---

## Docker (when available)

Docker is not installed on this development machine. When Docker +
`nvidia-container-toolkit` are available:

```bash
# Discover free ports first
ss -tlnp

# Edit .env with chosen ports, then:
docker compose up --build
```

The `docker-compose.yml` configures Redis, backend, and worker with GPU access.
The frontend still runs via `bash scripts/start-frontend.sh`.

---

## API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/jobs` | Upload video (multipart), returns `{job_id}` |
| GET | `/api/jobs/{id}` | Poll status, get analysis + insights |
| GET | `/api/jobs/{id}/video` | Stream annotated MP4 (range requests) |
| POST | `/api/jobs/{id}/impact` | Mark impact frame `{frame_index}` |
| POST | `/api/jobs/{id}/feedback` | Thumbs up/down `{insight_id, useful}` |
| GET | `/health` | Health check |

Interactive docs: **http://localhost:8082/docs**

---

## File layout per job

```
data/jobs/{job_id}/
  raw.mov              # original upload
  normalized.mp4       # H.264 CFR, rotation fixed, ≤1080p
  keypoints.jsonl      # one JSON line per frame
  analysis.json        # computed metrics
  insights.json        # LLM outputs (empty if no API key)
  annotated.mp4        # skeleton overlay burned in
  llm_log.jsonl        # every LLM prompt + response
  key_frames/          # JPEG key frames sent to vision model
    start_of_backlift.jpg
    top_of_backlift.jpg
    mid_shot.jpg
    impact_{N}.jpg     # if user marked impact
```

---

## End-to-end tests

```bash
cd backend
~/.local/bin/uv sync

# Test 1: deterministic pipeline (no API key needed)
python ../tests/test_e2e.py

# Test 2: LLM insights
ANTHROPIC_API_KEY=sk-ant-... python ../tests/test_e2e.py

# Use a real video
VIDEO_PATH=/path/to/batting.mov python ../tests/test_e2e.py
```

The tests create a synthetic 5-second video if `VIDEO_PATH` is not set.

---

## Known limitations

- **Pose accuracy**: MediaPipe is optimised for portrait/selfie capture.
  Bowler's-end footage at distance may miss detections — aim for 20-30m camera
  distance and good lighting.
- **Single batter**: If bowler is also in frame, metrics may be mixed.
- **FPS assumption**: The "Mark Impact Frame" button uses 30fps. Adjust if
  your camera shoots at a different rate.
- **Docker not installed**: Native scripts are the primary run path here.
- **No bat tracking**: v1 is pose-only. Bat speed, angle, and ball trajectory
  are not computed.

See `NOTES.md` for full implementation decisions and `PROMPTS.md` for LLM
prompt documentation.
