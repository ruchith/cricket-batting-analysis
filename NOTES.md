# Implementation Notes & Decisions

## Environment Observations (2026-04-18)

**Machine spec:**
- NVIDIA RTX 4080 Super (16GB VRAM), Driver 580.126.09, CUDA 13.0
- 64GB RAM
- Linux (Ubuntu), Python 3.12 via Anaconda

**Docker:** Not installed on this machine. Docker Compose files are provided
for environments where Docker + nvidia-container-toolkit are available.
Native startup scripts (`scripts/`) are the primary run path here.

**Tool versions discovered:**
- ffmpeg 7.1 (installed via conda-forge)
- redis-server 5.0.3 (installed via conda-forge)  
- Node.js v20.20.2
- Python 3.12 (Anaconda)
- uv 0.11.7 (installed to ~/.local/bin)

**Ports in use at scaffold time:**
`5000, 5173, 8000, 8001, 8090, 11434, 631, 53`

**Chosen ports:** Backend `8082`, Frontend `3009`, Redis `6382`

---

## Architecture Decisions

### Pose: MediaPipe over RTMPose
MediaPipe Pose was chosen over RTMPose (mmpose) because:
1. mmpose requires a complex build chain (MMCV with CUDA) that takes significant
   time to compile from source. MediaPipe is a pip install.
2. MediaPipe runs on CPU+GPU transparently, and for single-camera video of a
   single batter it provides sufficient accuracy.
3. If mmpose is needed later, the `pose.py` interface is narrow (takes video path,
   writes JSONL) — swapping it is straightforward.

### Keypoints format
Each line of `keypoints.jsonl` is:
```json
{"frame_index": 0, "timestamp": 0.0, "detected": true, "keypoints": {"nose": {"x": 640, "y": 360, "z": -0.1, "visibility": 0.99}, ...}}
```
Storing JSONL (not a big JSON array) allows streaming and cheap partial reads.
Any metric can be recomputed by reading the file without re-running pose.

### Metrics — what we compute in v1

| Metric | How | Limitation |
|---|---|---|
| Stance width | ankle distance / shoulder distance, first 10% of frames | Assumes batter in stance at start |
| Head stillness | variance of nose Y in first 20% of frames | Frame-of-delivery detection is manual |
| Backlift peak | max (shoulder_y - wrist_y) over all frames | Doesn't distinguish bat wrist from lead arm |
| Front-foot stride | max ankle displacement / shoulder width | Doesn't know which foot is front foot |
| Head-over-front-foot | nose.x - front_ankle.x at impact frame | Only computed when user marks impact |

### LLM — why Haiku for coaching, Sonnet for vision/shot

Haiku is fast and cheap for structured JSON generation from numeric inputs.
The coaching feedback is purely a rephrasing task — Haiku handles this well.

Sonnet is used for:
1. Shot classification — requires understanding pose kinematics and cricket context.
2. Vision review — requires multimodal reasoning about bat face, eye level, etc.

Both are called at most once per video (plus once per impact-mark for vision).
They are never on the per-frame hot path.

### Video streaming
The `/video` endpoint implements HTTP Range requests manually so the `<video>`
element can seek without downloading the full file first. This is required for
any video longer than ~30 seconds.

### arq vs Celery
arq was chosen per spec. It is simpler (no broker concepts, no worker classes)
and has native async support.

### Feedback flywheel
Every LLM-generated insight (coaching point, drill, etc.) gets a unique ID
(`strength-0`, `issue-1`, etc.) so thumbs-up/down are tracked per-insight.
The `data/llm_feedback.jsonl` file records `(ts, job_id, insight_id, useful)`.
Over time this enables prompt iteration guided by which tips users find helpful.

---

## Known Limitations

1. **Pose accuracy on wide-angle iPhone footage**: MediaPipe is tuned for
   portrait-orientation selfie-style capture. Bowler's-end footage (landscape,
   subject at distance) may have lower detection rates. Recommended camera
   distance: 20–30m.

2. **No bat detection**: v1 is pose-only. Bat angle, bat speed, and ball
   trajectory are not computed. The LLM vision review partially compensates.

3. **FPS assumption in frontend**: The "Mark Impact Frame" button estimates
   frame index as `currentTime × 30`. If the source video is a different FPS,
   this will be slightly off. A future fix is to read FPS from the job metadata.

4. **Single batter assumption**: Metrics are computed over all detected pose
   landmarks. If both bowler and batter are visible, the algorithm may mix up
   which person to track.

5. **Docker**: Not installed on this machine. See README for native run path.
   docker-compose.yml is provided for GPU-enabled Docker environments.

6. **Redis version**: conda-forge provides Redis 5.0. arq works fine with 5.x,
   but Redis 6+ is recommended for production (ACLs, better persistence).
