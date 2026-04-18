"""Detect shot start/end boundaries from pose keypoints.

Algorithm:
  1. Compute per-frame max wrist-height-above-shoulder (smoothed).
  2. Find the peak (top of backlift).
  3. Compute baseline from pre-peak still period.
  4. Shot start  = first frame where height exceeds  base + 0.15 * (peak - base).
  5. Shot end    = first frame after peak where height drops below
                  base + 0.20 * (peak - base)  (post follow-through).
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)


def _load_keypoints(kp_path: Path) -> list[dict]:
    with kp_path.open() as f:
        return [json.loads(l) for l in f if l.strip()]


def _wrist_height(frame: dict) -> float | None:
    """Pixels that the highest wrist sits above its same-side shoulder (positive = above)."""
    kp = frame.get("keypoints", {})
    best = None
    for side in ("right", "left"):
        w = kp.get(f"{side}_wrist")
        s = kp.get(f"{side}_shoulder")
        if not (w and s):
            continue
        if w.get("visibility", 0) < 0.3 or s.get("visibility", 0) < 0.3:
            continue
        h = s["y"] - w["y"]          # positive when wrist is above shoulder
        if best is None or h > best:
            best = h
    return best


def _smooth(values: list[float], window: int = 5) -> list[float]:
    if len(values) < window:
        return values
    arr = np.array(values, dtype=float)
    kernel = np.ones(window) / window
    return np.convolve(arr, kernel, mode="same").tolist()


def detect_shot_boundaries(kp_path: Path) -> dict:
    """
    Return {shot_start_frame, shot_end_frame, shot_start_ts, shot_end_ts,
            peak_frame, peak_ts, method}.
    Falls back to full-clip boundaries if detection is ambiguous.
    """
    frames = _load_keypoints(kp_path)
    if not frames:
        return _fallback(frames)

    # Build (frame_index, timestamp, wrist_height) for detected frames only
    series: list[tuple[int, float, float]] = []
    for f in frames:
        if not f.get("detected"):
            continue
        h = _wrist_height(f)
        if h is not None:
            series.append((f["frame_index"], f["timestamp"], h))

    if len(series) < 10:
        return _fallback(frames)

    heights = [s[2] for s in series]
    smoothed = _smooth(heights, window=7)

    peak_local_idx = int(np.argmax(smoothed))
    peak_frame, peak_ts, _ = series[peak_local_idx]

    # Baseline: median of first 15% of series (stance period)
    pre_count = max(1, len(series) // 7)
    baseline = float(np.median(smoothed[:pre_count]))
    peak_val = smoothed[peak_local_idx]
    swing = peak_val - baseline

    if swing < 5:
        # Very little wrist movement — can't reliably segment
        log.info("Segmentation: small wrist swing (%.1fpx), using full clip", swing)
        return _fallback(frames)

    start_threshold = baseline + 0.15 * swing
    end_threshold   = baseline + 0.20 * swing

    # Shot start: last frame BEFORE peak where height < start_threshold (walk back from peak)
    shot_start_local = 0
    for i in range(peak_local_idx, -1, -1):
        if smoothed[i] < start_threshold:
            shot_start_local = i
            break

    # Shot end: first frame AFTER peak where height < end_threshold
    shot_end_local = len(series) - 1
    for i in range(peak_local_idx, len(series)):
        if smoothed[i] < end_threshold:
            shot_end_local = i
            break

    shot_start_frame, shot_start_ts, _ = series[shot_start_local]
    shot_end_frame, shot_end_ts, _     = series[shot_end_local]

    log.info(
        "Segmentation: start=f%d (%.2fs), peak=f%d (%.2fs), end=f%d (%.2fs), swing=%.1fpx",
        shot_start_frame, shot_start_ts,
        peak_frame, peak_ts,
        shot_end_frame, shot_end_ts,
        swing,
    )

    return {
        "shot_start_frame": shot_start_frame,
        "shot_end_frame":   shot_end_frame,
        "shot_start_ts":    round(shot_start_ts, 3),
        "shot_end_ts":      round(shot_end_ts, 3),
        "peak_frame":       peak_frame,
        "peak_ts":          round(peak_ts, 3),
        "method":           "wrist_height",
    }


def _fallback(frames: list[dict]) -> dict:
    total = len(frames)
    last_ts = frames[-1]["timestamp"] if frames else 0.0
    return {
        "shot_start_frame": 0,
        "shot_end_frame":   max(0, total - 1),
        "shot_start_ts":    0.0,
        "shot_end_ts":      round(last_ts, 3),
        "peak_frame":       total // 2,
        "peak_ts":          round(last_ts / 2, 3),
        "method":           "fallback_full_clip",
    }
