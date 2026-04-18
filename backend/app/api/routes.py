"""All API route handlers."""
from __future__ import annotations

import json
import logging
import time
import uuid
from pathlib import Path

import aiofiles
from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse

from app.config import ANTHROPIC_API_KEY, DATA_DIR, FEEDBACK_FILE, JOBS_DIR
from app.models import FeedbackRequest, ImpactRequest, JobStatus, Stage

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api")

_UPLOAD_CHUNK = 1024 * 1024  # 1 MB


# ── POST /api/jobs — upload video, enqueue pipeline ──────────────────────────

@router.post("/jobs")
async def create_job(request: Request, file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith((".mov", ".mp4")):
        raise HTTPException(400, "Only .mov and .mp4 files are accepted")

    job_id = str(uuid.uuid4())
    job_dir = JOBS_DIR / job_id
    job_dir.mkdir(parents=True)

    # Save upload to temp path (worker moves it to raw.mov)
    suffix = Path(file.filename).suffix
    upload_path = DATA_DIR / f"_upload_{job_id}{suffix}"
    async with aiofiles.open(upload_path, "wb") as f:
        while chunk := await file.read(_UPLOAD_CHUNK):
            await f.write(chunk)

    # Write initial status
    (job_dir / "status.json").write_text(
        json.dumps({"stage": Stage.queued.value, "progress": 0.0})
    )

    # Enqueue
    pool = request.app.state.arq_pool
    await pool.enqueue_job("process_video", job_id, str(upload_path))

    log.info("Enqueued job %s for %s (%.1f KB)", job_id, file.filename,
             upload_path.stat().st_size / 1024)
    return {"job_id": job_id}


# ── GET /api/jobs/{job_id} — poll status ─────────────────────────────────────

@router.get("/jobs/{job_id}")
async def get_job(job_id: str):
    job_dir = _require_job(job_id)
    status_file = job_dir / "status.json"
    if not status_file.exists():
        raise HTTPException(404, "Status not found")

    status = json.loads(status_file.read_text())
    analysis = None
    insights = None

    analysis_file = job_dir / "analysis.json"
    if analysis_file.exists():
        analysis = json.loads(analysis_file.read_text())

    insights_file = job_dir / "insights.json"
    if insights_file.exists():
        raw = json.loads(insights_file.read_text())
        insights = raw if raw else None

    has_video = (job_dir / "annotated.mp4").exists()

    return {
        "job_id": job_id,
        "stage": status.get("stage"),
        "progress": status.get("progress", 0.0),
        "error": status.get("error"),
        "analysis": analysis,
        "insights": insights,
        "has_annotated_video": has_video,
        "has_llm_insights": bool(insights),        # did this job produce insights?
        "llm_enabled": bool(ANTHROPIC_API_KEY),    # is the key configured right now?
    }


# ── GET /api/jobs/{job_id}/video — stream annotated.mp4 with range support ───

@router.get("/jobs/{job_id}/video")
async def stream_video(job_id: str, request: Request):
    job_dir = _require_job(job_id)
    video_path = job_dir / "annotated.mp4"
    if not video_path.exists():
        raise HTTPException(404, "Annotated video not ready")

    file_size = video_path.stat().st_size
    range_header = request.headers.get("range")

    if range_header:
        start, end = _parse_range(range_header, file_size)
        chunk_size = end - start + 1

        async def _iter():
            async with aiofiles.open(video_path, "rb") as f:
                await f.seek(start)
                remaining = chunk_size
                while remaining > 0:
                    read = min(remaining, 65536)
                    data = await f.read(read)
                    if not data:
                        break
                    yield data
                    remaining -= len(data)

        return StreamingResponse(
            _iter(),
            status_code=206,
            media_type="video/mp4",
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(chunk_size),
            },
        )

    return FileResponse(
        video_path,
        media_type="video/mp4",
        headers={"Accept-Ranges": "bytes", "Content-Length": str(file_size)},
    )


def _parse_range(header: str, file_size: int) -> tuple[int, int]:
    header = header.strip()
    if not header.startswith("bytes="):
        raise HTTPException(416, "Invalid range header")
    parts = header[6:].split("-")
    start = int(parts[0]) if parts[0] else 0
    end = int(parts[1]) if parts[1] else file_size - 1
    end = min(end, file_size - 1)
    if start > end:
        raise HTTPException(416, "Invalid range")
    return start, end


# ── POST /api/jobs/{job_id}/impact — mark impact frame ──────────────────────

@router.post("/jobs/{job_id}/impact")
async def mark_impact(job_id: str, body: ImpactRequest, request: Request):
    job_dir = _require_job(job_id)
    kp_path = job_dir / "keypoints.jsonl"
    analysis_path = job_dir / "analysis.json"

    if not kp_path.exists():
        raise HTTPException(400, "Keypoints not ready — pipeline still running")

    from app.pipeline.metrics import compute_metrics
    analysis = compute_metrics(kp_path, impact_frame=body.frame_index)
    analysis_path.write_text(json.dumps(analysis, indent=2))

    # Trigger follow-up Sonnet vision call on the impact frame if API key present
    if ANTHROPIC_API_KEY:
        import asyncio
        asyncio.create_task(_impact_vision(job_id, job_dir, body.frame_index))

    return {"analysis": analysis}


async def _impact_vision(job_id: str, job_dir: Path, frame_index: int) -> None:
    import cv2
    from app.pipeline import llm_client

    video_path = job_dir / "normalized.mp4"
    if not video_path.exists():
        return

    frames_dir = job_dir / "key_frames"
    frames_dir.mkdir(exist_ok=True)
    frame_path = frames_dir / f"impact_{frame_index}.jpg"

    cap = cv2.VideoCapture(str(video_path))
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
    ok, frame = cap.read()
    cap.release()
    if not ok:
        return

    cv2.imwrite(str(frame_path), frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    vision = llm_client.vision_review_frames(
        job_dir, [{"label": f"impact_frame_{frame_index}", "path": str(frame_path)}]
    )

    if vision:
        insights_path = job_dir / "insights.json"
        existing = {}
        if insights_path.exists():
            existing = json.loads(insights_path.read_text())
        existing["impact_vision"] = vision
        insights_path.write_text(json.dumps(existing, indent=2))
        log.info("[%s] Impact vision appended", job_id)


# ── POST /api/jobs/{job_id}/feedback — log thumbs up/down ────────────────────

@router.post("/jobs/{job_id}/feedback")
async def log_feedback(job_id: str, body: FeedbackRequest):
    _require_job(job_id)
    entry = {
        "ts": time.time(),
        "job_id": job_id,
        "insight_id": body.insight_id,
        "useful": body.useful,
    }
    FEEDBACK_FILE.parent.mkdir(parents=True, exist_ok=True)
    with FEEDBACK_FILE.open("a") as f:
        f.write(json.dumps(entry) + "\n")
    return {"ok": True}


# ── Helper ────────────────────────────────────────────────────────────────────

def _require_job(job_id: str) -> Path:
    job_dir = JOBS_DIR / job_id
    if not job_dir.exists():
        raise HTTPException(404, f"Job {job_id} not found")
    return job_dir
