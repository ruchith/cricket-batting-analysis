"""Stage 5: burn skeleton overlay onto normalized video → annotated.mp4.

Skeleton color reflects per-frame pose confidence:
  green  → high confidence (≥ 0.7)
  yellow → medium confidence (0.4–0.7)
  red    → low confidence (< 0.4)

Shot start/end boundaries are labelled on the relevant frames.
"""
from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path


async def _nvenc_available() -> bool:
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-hide_banner", "-encoders",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    out, _ = await proc.communicate()
    return b"h264_nvenc" in out

import cv2
import numpy as np

log = logging.getLogger(__name__)

_CONNECTIONS = [
    ("left_shoulder", "right_shoulder"),
    ("left_shoulder", "left_elbow"), ("left_elbow", "left_wrist"),
    ("right_shoulder", "right_elbow"), ("right_elbow", "right_wrist"),
    ("left_shoulder", "left_hip"), ("right_shoulder", "right_hip"),
    ("left_hip", "right_hip"),
    ("left_hip", "left_knee"), ("left_knee", "left_ankle"),
    ("right_hip", "right_knee"), ("right_knee", "right_ankle"),
    ("left_shoulder", "nose"), ("right_shoulder", "nose"),
]

# BGR colors per confidence tier
_HIGH   = {"joint": (128, 255,   0), "bone": (0, 220, 255)}   # green / yellow
_MEDIUM = {"joint": (0,   220, 255), "bone": (0, 165, 255)}   # yellow / orange
_LOW    = {"joint": (0,    80, 255), "bone": (0,  40, 200)}   # orange / dark-red


def _colors(confidence: float) -> tuple[tuple, tuple]:
    if confidence >= 0.7:
        return _HIGH["joint"], _HIGH["bone"]
    if confidence >= 0.4:
        return _MEDIUM["joint"], _MEDIUM["bone"]
    return _LOW["joint"], _LOW["bone"]


def _load_keypoints(kp_path: Path) -> dict[int, dict]:
    kp_map: dict[int, dict] = {}
    with kp_path.open() as f:
        for line in f:
            line = line.strip()
            if line:
                entry = json.loads(line)
                if entry["detected"]:
                    kp_map[entry["frame_index"]] = entry["keypoints"]
    return kp_map


def _load_confidence(confidence_path: Path | None) -> dict[int, float]:
    if not confidence_path or not confidence_path.exists():
        return {}
    data = json.loads(confidence_path.read_text())
    return {item["frame"]: item["confidence"] for item in data}


async def run(
    job_dir: Path,
    video_path: Path,
    kp_path: Path,
    confidence_path: Path | None = None,
    segmentation: dict | None = None,
) -> Path:
    out_path = job_dir / "annotated.mp4"
    kp_map = _load_keypoints(kp_path)
    conf_map = _load_confidence(confidence_path)

    shot_start = segmentation.get("shot_start_frame") if segmentation else None
    shot_end   = segmentation.get("shot_end_frame")   if segmentation else None

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    w   = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h   = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(out_path), fourcc, fps, (w, h))

    frame_idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break

        kp        = kp_map.get(frame_idx)
        confidence = conf_map.get(frame_idx, 0.5)
        joint_color, bone_color = _colors(confidence)

        if kp:
            pts: dict[str, tuple[int, int]] = {
                name: (int(d["x"]), int(d["y"]))
                for name, d in kp.items()
                if d.get("visibility", 0) > 0.3
            }

            for a, b in _CONNECTIONS:
                if a in pts and b in pts:
                    cv2.line(frame, pts[a], pts[b], bone_color, 2, cv2.LINE_AA)

            for pt in pts.values():
                cv2.circle(frame, pt, 4, joint_color, -1, cv2.LINE_AA)

        # Frame counter + confidence badge
        cv2.putText(frame, f"f{frame_idx}", (10, 28),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 255, 255), 2)
        if kp:
            badge_color = joint_color
            cv2.putText(frame, f"conf {confidence:.2f}", (10, 54),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, badge_color, 2)

        # Shot boundary labels
        if shot_start is not None and frame_idx == shot_start:
            cv2.putText(frame, "SHOT START", (10, h - 20),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 128), 2)
        if shot_end is not None and frame_idx == shot_end:
            cv2.putText(frame, "SHOT END", (10, h - 20),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 80, 255), 2)

        writer.write(frame)
        frame_idx += 1

    cap.release()
    writer.release()

    # Re-mux to browser-compatible H.264
    muxed = job_dir / "annotated_h264.mp4"
    use_nvenc = await _nvenc_available()
    if use_nvenc:
        log.info("Render mux: using h264_nvenc encoder")
        mux_cmd = [
            "ffmpeg", "-y", "-i", str(out_path),
            "-c:v", "h264_nvenc", "-preset", "p4", "-cq", "23",
            "-movflags", "+faststart",
            str(muxed),
        ]
    else:
        log.info("Render mux: using libx264 encoder (NVENC not available)")
        mux_cmd = [
            "ffmpeg", "-y", "-i", str(out_path),
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-movflags", "+faststart",
            str(muxed),
        ]
    proc = await asyncio.create_subprocess_exec(
        *mux_cmd,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode == 0:
        out_path.unlink()
        muxed.rename(out_path)
    else:
        log.warning("ffmpeg mux failed: %s", stderr.decode()[-200:])

    log.info("Render complete: %s", out_path)
    return out_path
