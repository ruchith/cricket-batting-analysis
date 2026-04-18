"""arq worker tasks for the cricket analysis pipeline."""
from __future__ import annotations

import json
import logging
from pathlib import Path

from app.config import JOBS_DIR, ANTHROPIC_API_KEY
from app.models import Stage

log = logging.getLogger(__name__)


def _status_path(job_dir: Path) -> Path:
    return job_dir / "status.json"


def _write_status(job_dir: Path, stage: Stage, progress: float, error: str | None = None) -> None:
    status = {"stage": stage.value, "progress": progress}
    if error:
        status["error"] = error
    _status_path(job_dir).write_text(json.dumps(status))


async def process_video(ctx: dict, job_id: str, upload_path: str) -> None:
    job_dir = JOBS_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    upload = Path(upload_path)

    try:
        # ── Stage 1: Ingest
        _write_status(job_dir, Stage.ingest, 0.05)
        from app.pipeline import ingest
        raw = await ingest.run(job_dir, upload)
        log.info("[%s] Ingest complete", job_id)

        # ── Stage 2: Normalize
        _write_status(job_dir, Stage.normalize, 0.15)
        from app.pipeline import normalize
        video = await normalize.run(job_dir, raw)
        log.info("[%s] Normalize complete", job_id)

        # ── Stage 3: Pose
        _write_status(job_dir, Stage.pose, 0.30)
        from app.pipeline import pose
        kp_path = await pose.run(job_dir, video)
        log.info("[%s] Pose complete", job_id)

        # ── Stage 4: Metrics
        _write_status(job_dir, Stage.metrics, 0.65)
        from app.pipeline.metrics import compute_metrics
        analysis = compute_metrics(kp_path)
        analysis_path = job_dir / "analysis.json"
        analysis_path.write_text(json.dumps(analysis, indent=2))
        log.info("[%s] Metrics complete: %s", job_id, analysis)

        # ── Stage 5: Render
        _write_status(job_dir, Stage.render, 0.75)
        from app.pipeline import render
        await render.run(job_dir, video, kp_path)
        log.info("[%s] Render complete", job_id)

        # ── Stage 6: LLM insights (skippable)
        _write_status(job_dir, Stage.llm, 0.88)
        if ANTHROPIC_API_KEY:
            await _run_llm_stage(job_id, job_dir, analysis, kp_path, video)
        else:
            log.info("[%s] Skipping LLM stage (no ANTHROPIC_API_KEY)", job_id)
            (job_dir / "insights.json").write_text(json.dumps({}))

        _write_status(job_dir, Stage.complete, 1.0)
        log.info("[%s] Pipeline complete", job_id)

    except Exception as e:
        log.exception("[%s] Pipeline failed", job_id)
        _write_status(job_dir, Stage.failed, 0.0, str(e))
    finally:
        # Clean up the temp upload file
        if upload.exists():
            upload.unlink(missing_ok=True)


async def _run_llm_stage(
    job_id: str,
    job_dir: Path,
    analysis: dict,
    kp_path: Path,
    video_path: Path,
) -> None:
    from app.pipeline import llm_client
    from app.pipeline.metrics import build_pose_summary

    insights: dict = {}

    # Coaching feedback via Haiku
    feedback = llm_client.generate_coaching_feedback(job_dir, analysis)
    if feedback:
        insights["coaching_feedback"] = feedback

    # Shot classification via Sonnet
    pose_summary = build_pose_summary(kp_path)
    shot = llm_client.classify_shot(job_dir, pose_summary)
    if shot:
        insights["shot_classification"] = shot

    # Vision review via Sonnet — extract 3 key frames
    key_frames = _extract_key_frames(job_dir, video_path, kp_path)
    if key_frames:
        vision = llm_client.vision_review_frames(job_dir, key_frames)
        if vision:
            insights["vision_review"] = vision

    (job_dir / "insights.json").write_text(json.dumps(insights, indent=2))
    log.info("[%s] LLM insights written", job_id)


def _extract_key_frames(job_dir: Path, video_path: Path, kp_path: Path) -> list[dict]:
    """Extract start-of-backlift, top-of-backlift, and midpoint frames as JPEG."""
    import cv2
    import json as _json

    frames_dir = job_dir / "key_frames"
    frames_dir.mkdir(exist_ok=True)

    # Load keypoints to find backlift peak
    frames_data = []
    with kp_path.open() as f:
        for line in f:
            line = line.strip()
            if line:
                frames_data.append(_json.loads(line))

    detected = [f for f in frames_data if f["detected"] and f["keypoints"]]
    if not detected:
        return []

    # Find frame with highest right wrist above right shoulder
    best_backlift_val = -float("inf")
    best_backlift_idx = len(detected) // 2

    for fd in detected:
        kp = fd["keypoints"]
        rw = kp.get("right_wrist")
        rs = kp.get("right_shoulder")
        if rw and rs and rw.get("visibility", 0) > 0.3 and rs.get("visibility", 0) > 0.3:
            height = rs["y"] - rw["y"]
            if height > best_backlift_val:
                best_backlift_val = height
                best_backlift_idx = fd["frame_index"]

    # Three keyframes: start, top of backlift, midpoint
    total = len(frames_data)
    keyframe_indices = {
        "start_of_backlift": max(0, best_backlift_idx - total // 6),
        "top_of_backlift": best_backlift_idx,
        "mid_shot": min(total - 1, best_backlift_idx + total // 8),
    }

    cap = cv2.VideoCapture(str(video_path))
    result = []
    for label, idx in keyframe_indices.items():
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, frame = cap.read()
        if ok:
            out_path = frames_dir / f"{label}.jpg"
            cv2.imwrite(str(out_path), frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
            result.append({"label": label, "path": str(out_path)})
    cap.release()
    return result
