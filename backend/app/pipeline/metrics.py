"""Stage 4: compute biomechanical metrics from keypoints.jsonl."""
from __future__ import annotations
import json
import logging
import math
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)


def _load_keypoints(kp_path: Path) -> list[dict]:
    frames = []
    with kp_path.open() as f:
        for line in f:
            line = line.strip()
            if line:
                frames.append(json.loads(line))
    return frames


def _pt(kp: dict, name: str) -> tuple[float, float] | None:
    """Get (x, y) for a keypoint name, or None if missing/low visibility."""
    k = kp.get(name)
    if k and k.get("visibility", 0) > 0.3:
        return k["x"], k["y"]
    return None


def _dist(a: tuple, b: tuple) -> float:
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)


def compute_metrics(kp_path: Path, impact_frame: int | None = None) -> dict:
    frames = _load_keypoints(kp_path)
    if not frames:
        return {}

    detected = [f for f in frames if f["detected"] and f["keypoints"]]
    if not detected:
        return {}

    # ── Stance width (average over first 10% of detected frames)
    stance_frames = detected[: max(1, len(detected) // 10)]
    stance_widths: list[float] = []
    shoulder_widths: list[float] = []
    for f in stance_frames:
        kp = f["keypoints"]
        la, ra = _pt(kp, "left_ankle"), _pt(kp, "right_ankle")
        ls, rs = _pt(kp, "left_shoulder"), _pt(kp, "right_shoulder")
        if la and ra and ls and rs:
            ankle_w = _dist(la, ra)
            shoulder_w = _dist(ls, rs)
            if shoulder_w > 0:
                stance_widths.append(ankle_w / shoulder_w)
                shoulder_widths.append(shoulder_w)

    stance_width_normalized = float(np.mean(stance_widths)) if stance_widths else None

    # ── Head stillness (nose Y variance in first 20% of detected frames)
    head_frames = detected[: max(1, len(detected) // 5)]
    nose_ys = []
    for f in head_frames:
        n = _pt(f["keypoints"], "nose")
        if n:
            nose_ys.append(n[1])
    head_stillness_variance = float(np.var(nose_ys)) if len(nose_ys) > 2 else None

    # ── Backlift peak height: max(wrist_y - shoulder_y) — lower y = higher in frame
    # We use the wrist that goes highest (right wrist for right-handed batter)
    backlift_vals: list[float] = []
    for f in detected:
        kp = f["keypoints"]
        for wrist_name in ("right_wrist", "left_wrist"):
            for shoulder_name in ("right_shoulder", "left_shoulder"):
                w = _pt(kp, wrist_name)
                s = _pt(kp, shoulder_name)
                if w and s:
                    # negative = wrist above shoulder (y increases downward)
                    height_above = s[1] - w[1]
                    backlift_vals.append(height_above)

    backlift_peak_height = float(max(backlift_vals)) if backlift_vals else None

    # ── Front-foot stride length: displacement of lead ankle from stance to peak
    # Lead foot is the one that moves toward the pitch (lower y in top-down is further)
    # We measure max displacement of whichever ankle moves the most
    if len(detected) > 5:
        early_kp = detected[0]["keypoints"]
        la0 = _pt(early_kp, "left_ankle")
        ra0 = _pt(early_kp, "right_ankle")
        max_stride = 0.0
        ref_shoulder_w = shoulder_widths[0] if shoulder_widths else 100.0

        for f in detected[1:]:
            kp = f["keypoints"]
            la = _pt(kp, "left_ankle")
            ra = _pt(kp, "right_ankle")
            if la0 and la:
                max_stride = max(max_stride, _dist(la, la0))
            if ra0 and ra:
                max_stride = max(max_stride, _dist(ra, ra0))

        front_foot_stride = float(max_stride / ref_shoulder_w) if ref_shoulder_w > 0 else None
    else:
        front_foot_stride = None

    result: dict = {
        "stance_width_normalized": stance_width_normalized,
        "head_stillness_variance": head_stillness_variance,
        "backlift_peak_height": backlift_peak_height,
        "front_foot_stride_length": front_foot_stride,
    }

    # ── Impact-frame metrics (only if impact_frame provided)
    if impact_frame is not None:
        impact_kp = None
        for f in frames:
            if f["frame_index"] == impact_frame and f["detected"]:
                impact_kp = f["keypoints"]
                break

        head_over_front_foot = None
        if impact_kp:
            nose = _pt(impact_kp, "nose")
            # Determine front foot (ankle with largest displacement from start)
            la = _pt(impact_kp, "left_ankle")
            ra = _pt(impact_kp, "right_ankle")
            if nose and (la or ra):
                front_ankle = la if la else ra
                if la and ra:
                    # Whichever ankle is further from nose x is front foot
                    front_ankle = la if abs(la[0] - nose[0]) < abs(ra[0] - nose[0]) else ra
                if front_ankle:
                    head_over_front_foot = float(nose[0] - front_ankle[0])

        result["impact_frame"] = impact_frame
        result["head_over_front_foot"] = head_over_front_foot

    return result


def build_pose_summary(kp_path: Path, n_keyframes: int = 10) -> str:
    """Produce a compact text summary of pose at N evenly-spaced frames for LLM."""
    frames = _load_keypoints(kp_path)
    detected = [f for f in frames if f["detected"] and f["keypoints"]]
    if not detected:
        return "No pose data available."

    step = max(1, len(detected) // n_keyframes)
    sampled = detected[::step][:n_keyframes]

    lines = [f"Pose trajectory ({len(sampled)} key frames of {len(frames)} total):"]
    for f in sampled:
        kp = f["keypoints"]
        ts = f["timestamp"]
        # Compute simple joint angles
        def angle_at(a_name, b_name, c_name):
            a = _pt(kp, a_name)
            b = _pt(kp, b_name)
            c = _pt(kp, c_name)
            if not (a and b and c):
                return None
            ba = (a[0]-b[0], a[1]-b[1])
            bc = (c[0]-b[0], c[1]-b[1])
            dot = ba[0]*bc[0] + ba[1]*bc[1]
            mag = math.sqrt(ba[0]**2+ba[1]**2) * math.sqrt(bc[0]**2+bc[1]**2)
            if mag == 0:
                return None
            return round(math.degrees(math.acos(max(-1, min(1, dot/mag)))), 1)

        r_elbow = angle_at("right_shoulder", "right_elbow", "right_wrist")
        l_elbow = angle_at("left_shoulder", "left_elbow", "left_wrist")
        r_knee = angle_at("right_hip", "right_knee", "right_ankle")
        l_knee = angle_at("left_hip", "left_knee", "left_ankle")
        hip = angle_at("left_shoulder", "left_hip", "left_knee")

        parts = [f"t={ts:.2f}s"]
        if r_elbow is not None: parts.append(f"R_elbow={r_elbow}°")
        if l_elbow is not None: parts.append(f"L_elbow={l_elbow}°")
        if r_knee is not None: parts.append(f"R_knee={r_knee}°")
        if l_knee is not None: parts.append(f"L_knee={l_knee}°")
        if hip is not None: parts.append(f"hip_angle={hip}°")
        lines.append("  " + ", ".join(parts))

    return "\n".join(lines)
