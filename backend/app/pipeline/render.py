"""Stage 5: burn skeleton overlay onto normalized video → annotated.mp4."""
from __future__ import annotations
import asyncio
import json
import logging
from pathlib import Path

import cv2
import numpy as np

log = logging.getLogger(__name__)

# MediaPipe pose connections (subset for clarity)
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

_JOINT_COLOR = (0, 255, 128)    # green joints
_BONE_COLOR = (255, 200, 0)     # yellow bones


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


async def run(job_dir: Path, video_path: Path, kp_path: Path) -> Path:
    out_path = job_dir / "annotated.mp4"
    kp_map = _load_keypoints(kp_path)

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(out_path), fourcc, fps, (w, h))

    frame_idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break

        kp = kp_map.get(frame_idx)
        if kp:
            pts: dict[str, tuple[int, int]] = {}
            for name, data in kp.items():
                if data.get("visibility", 0) > 0.3:
                    pts[name] = (int(data["x"]), int(data["y"]))

            # Draw bones
            for a_name, b_name in _CONNECTIONS:
                if a_name in pts and b_name in pts:
                    cv2.line(frame, pts[a_name], pts[b_name], _BONE_COLOR, 2, cv2.LINE_AA)

            # Draw joints
            for pt in pts.values():
                cv2.circle(frame, pt, 4, _JOINT_COLOR, -1, cv2.LINE_AA)

            # Frame counter
            cv2.putText(
                frame, f"Frame {frame_idx}", (10, 30),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2,
            )

        writer.write(frame)
        frame_idx += 1

    cap.release()
    writer.release()

    # Re-mux with ffmpeg to ensure browser-compatible H.264
    muxed = job_dir / "annotated_h264.mp4"
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y", "-i", str(out_path),
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-movflags", "+faststart",
        str(muxed),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode == 0:
        out_path.unlink()
        muxed.rename(out_path)
    else:
        log.warning("ffmpeg mux failed (using raw mp4v output): %s", stderr.decode()[-200:])

    log.info("Render complete: %s", out_path)
    return out_path
