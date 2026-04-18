"""Stage 2: transcode to H.264 CFR, fix iPhone rotation, downscale to 1080p max."""
from __future__ import annotations
import asyncio
import json
import logging
import subprocess
from pathlib import Path

log = logging.getLogger(__name__)


def _probe_rotation(src: Path) -> int:
    """Read rotation metadata via ffprobe. Returns degrees (0, 90, 180, 270)."""
    cmd = [
        "ffprobe", "-v", "quiet", "-print_format", "json",
        "-show_streams", str(src),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        return 0
    data = json.loads(result.stdout)
    for stream in data.get("streams", []):
        tags = stream.get("tags", {})
        rot = tags.get("rotate", tags.get("rotation", "0"))
        try:
            return int(rot)
        except ValueError:
            pass
        # Check side_data_list for display matrix rotation
        for sd in stream.get("side_data_list", []):
            if "rotation" in sd:
                try:
                    return abs(int(sd["rotation"]))
                except (ValueError, TypeError):
                    pass
    return 0


def _build_filter(rotation: int) -> str:
    """Build vf filter chain for rotation + scale."""
    scale = "scale='min(iw,1920)':min(ih\\,1080):force_original_aspect_ratio=decrease"
    if rotation == 90:
        return f"transpose=1,{scale}"
    elif rotation == 180:
        return f"transpose=2,transpose=2,{scale}"
    elif rotation == 270:
        return f"transpose=2,{scale}"
    return scale


async def run(job_dir: Path, raw: Path) -> Path:
    out = job_dir / "normalized.mp4"

    # Probe source FPS and rotation
    probe_cmd = [
        "ffprobe", "-v", "quiet", "-print_format", "json",
        "-show_streams", str(raw),
    ]
    probe_result = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=30)
    fps = "30"
    if probe_result.returncode == 0:
        data = json.loads(probe_result.stdout)
        for stream in data.get("streams", []):
            if stream.get("codec_type") == "video":
                r = stream.get("r_frame_rate", "30/1")
                try:
                    num, den = r.split("/")
                    fps = str(round(int(num) / int(den)))
                except Exception:
                    pass
                break

    rotation = _probe_rotation(raw)
    vf = _build_filter(rotation)
    log.info("Normalizing %s: rotation=%d fps=%s", raw.name, rotation, fps)

    cmd = [
        "ffmpeg", "-y", "-i", str(raw),
        "-vf", vf,
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-r", fps,            # force CFR
        "-vsync", "cfr",
        "-an",                # drop audio — not needed for analysis
        "-movflags", "+faststart",
        str(out),
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg normalize failed: {stderr.decode()[-500:]}")
    return out
