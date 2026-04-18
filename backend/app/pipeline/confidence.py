"""Compute per-frame pose confidence from keypoints.jsonl.

Confidence is the mean MediaPipe visibility score of the six core body
landmarks (shoulders, hips, knees) that are present in the frame.
Frames with no detection get confidence = 0.

The output is downsampled to at most MAX_POINTS entries so the API
response stays small even for long clips.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

log = logging.getLogger(__name__)

MAX_POINTS = 500

_CORE = [
    "left_shoulder", "right_shoulder",
    "left_hip",      "right_hip",
    "left_knee",     "right_knee",
    "nose",
]


def compute_confidence(kp_path: Path) -> list[dict]:
    """Return list of {frame, ts, confidence, detected} downsampled to MAX_POINTS."""
    raw: list[dict] = []
    with kp_path.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            entry = json.loads(line)
            frame_idx = entry["frame_index"]
            ts = entry["timestamp"]
            detected = entry.get("detected", False)

            if not detected or not entry.get("keypoints"):
                conf = 0.0
            else:
                kp = entry["keypoints"]
                visibilities = [
                    kp[name]["visibility"]
                    for name in _CORE
                    if name in kp and kp[name].get("visibility") is not None
                ]
                conf = float(sum(visibilities) / len(visibilities)) if visibilities else 0.0

            raw.append({
                "frame":      frame_idx,
                "ts":         round(ts, 3),
                "confidence": round(conf, 3),
                "detected":   detected,
            })

    if not raw:
        return []

    # Downsample evenly if needed
    if len(raw) <= MAX_POINTS:
        return raw

    step = len(raw) / MAX_POINTS
    result = []
    for i in range(MAX_POINTS):
        idx = min(int(i * step), len(raw) - 1)
        result.append(raw[idx])
    return result
