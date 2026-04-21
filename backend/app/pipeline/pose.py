"""Stage 3: run YOLOv8m-pose on every frame (batched GPU inference), write keypoints.jsonl.

Single-person app (cricket batter): takes the highest-confidence detection per frame.
COCO 17-keypoint format output.
"""
from __future__ import annotations
import json
import logging
import queue
import threading
from pathlib import Path

import torch
from ultralytics import YOLO

log = logging.getLogger(__name__)

_COCO_NAMES = [
    "nose", "left_eye", "right_eye", "left_ear", "right_ear",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle",
]

_MODEL_PATH = Path(__file__).parent / ".." / ".." / ".." / "yolov8m-pose.pt"
_MODEL_CACHE: YOLO | None = None

BATCH_SIZE = 16
QUEUE_MAXSIZE = 8


def _get_model() -> YOLO:
    global _MODEL_CACHE
    if _MODEL_CACHE is None:
        mp = _MODEL_PATH.resolve()
        model_path = str(mp) if mp.exists() else "yolov8m-pose.pt"
        _MODEL_CACHE = YOLO(model_path)
        device = "cuda" if torch.cuda.is_available() else "cpu"
        _MODEL_CACHE.to(device)
        log.info("YOLOv8-pose loaded on %s", device)
    return _MODEL_CACHE


def _read_frames(cap, out_q, batch_size):
    batch = []
    idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            if batch:
                out_q.put(batch)
            out_q.put(None)
            return
        batch.append((idx, frame))
        if len(batch) == batch_size:
            out_q.put(batch)
            batch = []
        idx += 1


async def run(job_dir: Path, video_path: Path) -> Path:
    import asyncio
    import cv2
    import numpy as np

    model = _get_model()
    out_path = job_dir / "keypoints.jsonl"

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    log.info("Pose (YOLOv8-CUDA): %s — %d frames %.1ffps %dx%d", video_path.name, frame_count, fps, w, h)

    frame_q: queue.Queue = queue.Queue(maxsize=QUEUE_MAXSIZE)
    reader = threading.Thread(target=_read_frames, args=(cap, frame_q, BATCH_SIZE), daemon=True)
    reader.start()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    results_map: dict[int, dict] = {}

    while True:
        batch = frame_q.get()
        if batch is None:
            break

        frames_bgr = [f for _, f in batch]
        frame_indices = [i for i, _ in batch]

        preds = model(frames_bgr, verbose=False, device=device)

        for pred, frame_idx in zip(preds, frame_indices):
            detected = False
            kps: dict = {}

            if pred.keypoints is not None and len(pred.keypoints) > 0:
                kps_xy = pred.keypoints.xy.cpu().numpy()       # (N, 17, 2)
                kps_conf = pred.keypoints.conf.cpu().numpy() if pred.keypoints.conf is not None else None

                # Pick detection with highest mean keypoint confidence
                if kps_conf is not None and len(kps_conf) > 0:
                    best = int(np.argmax(kps_conf.mean(axis=1)))
                else:
                    best = 0

                detected = True
                for ki, name in enumerate(_COCO_NAMES):
                    x, y = float(kps_xy[best, ki, 0]), float(kps_xy[best, ki, 1])
                    vis = float(kps_conf[best, ki]) if kps_conf is not None else 1.0
                    kps[name] = {"x": round(x, 2), "y": round(y, 2), "z": 0.0, "visibility": round(vis, 4)}

            results_map[frame_idx] = {
                "frame_index": frame_idx,
                "timestamp": round(frame_idx / fps, 4),
                "detected": detected,
                "keypoints": kps,
            }

        await asyncio.sleep(0)

    reader.join()
    cap.release()

    with out_path.open("w") as f:
        for idx in sorted(results_map):
            f.write(json.dumps(results_map[idx]) + "\n")

    log.info("Pose complete: %d frames, %d detected", frame_count, sum(1 for v in results_map.values() if v["detected"]))
    return out_path
