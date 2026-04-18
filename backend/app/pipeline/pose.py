"""Stage 3: run MediaPipe Pose on every frame, write keypoints.jsonl.

Uses the MediaPipe Tasks API (mediapipe >= 0.10), downloading the
pose_landmarker_full model on first run to DATA_DIR/models/.
"""
from __future__ import annotations
import json
import logging
import urllib.request
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)

_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/"
    "pose_landmarker/pose_landmarker_full/float16/latest/"
    "pose_landmarker_full.task"
)

# MediaPipe PoseLandmark enum indices (Tasks API)
_LANDMARK_NAMES = {
    0: "nose",
    1: "left_eye_inner", 2: "left_eye", 3: "left_eye_outer",
    4: "right_eye_inner", 5: "right_eye", 6: "right_eye_outer",
    7: "left_ear", 8: "right_ear",
    9: "mouth_left", 10: "mouth_right",
    11: "left_shoulder", 12: "right_shoulder",
    13: "left_elbow", 14: "right_elbow",
    15: "left_wrist", 16: "right_wrist",
    17: "left_pinky", 18: "right_pinky",
    19: "left_index", 20: "right_index",
    21: "left_thumb", 22: "right_thumb",
    23: "left_hip", 24: "right_hip",
    25: "left_knee", 26: "right_knee",
    27: "left_ankle", 28: "right_ankle",
    29: "left_heel", 30: "right_heel",
    31: "left_foot_index", 32: "right_foot_index",
}

# Names we care about (subset for metrics + rendering)
_KEEP = {
    "nose", "left_eye", "right_eye", "left_ear", "right_ear",
    "left_shoulder", "right_shoulder",
    "left_elbow", "right_elbow",
    "left_wrist", "right_wrist",
    "left_hip", "right_hip",
    "left_knee", "right_knee",
    "left_ankle", "right_ankle",
}


def _ensure_model() -> Path:
    from app.config import DATA_DIR
    model_dir = DATA_DIR / "models"
    model_dir.mkdir(parents=True, exist_ok=True)
    model_path = model_dir / "pose_landmarker_full.task"
    if not model_path.exists():
        log.info("Downloading MediaPipe pose model (~26 MB)…")
        urllib.request.urlretrieve(_MODEL_URL, model_path)
        log.info("Model downloaded to %s", model_path)
    return model_path


async def run(job_dir: Path, video_path: Path) -> Path:
    import cv2
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision as mp_vision

    model_path = _ensure_model()
    out_path = job_dir / "keypoints.jsonl"

    base_options = mp_python.BaseOptions(model_asset_path=str(model_path))
    options = mp_vision.PoseLandmarkerOptions(
        base_options=base_options,
        running_mode=mp_vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=0.5,
        min_pose_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    log.info("Pose: %s — %d frames at %.1ffps (%dx%d)", video_path.name, frame_count, fps, w, h)

    with mp_vision.PoseLandmarker.create_from_options(options) as landmarker, \
         out_path.open("w") as f:

        frame_idx = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break

            # MediaPipe Tasks expects RGB
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

            # Use timestamp in ms for VIDEO mode
            timestamp_ms = int(frame_idx * 1000 / fps)
            results = landmarker.detect_for_video(mp_image, timestamp_ms)

            detected = bool(results.pose_landmarks)
            kps: dict = {}

            if detected:
                # results.pose_landmarks is a list of pose(s); we take the first
                landmarks = results.pose_landmarks[0]
                for idx, lm in enumerate(landmarks):
                    name = _LANDMARK_NAMES.get(idx)
                    if name and name in _KEEP:
                        kps[name] = {
                            "x": round(lm.x * w, 2),
                            "y": round(lm.y * h, 2),
                            "z": round(lm.z, 4),
                            "visibility": round(lm.visibility if lm.visibility is not None else 1.0, 4),
                        }

            entry = {
                "frame_index": frame_idx,
                "timestamp": round(frame_idx / fps, 4),
                "detected": detected,
                "keypoints": kps,
            }
            f.write(json.dumps(entry) + "\n")
            frame_idx += 1

    cap.release()
    log.info("Pose complete: %d frames written", frame_idx)
    return out_path
