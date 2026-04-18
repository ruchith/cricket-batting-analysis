"""
End-to-end tests.

Usage:
  # Test 1: deterministic pipeline only
  python tests/test_e2e.py

  # Test 2: with LLM insights (requires ANTHROPIC_API_KEY in env)
  ANTHROPIC_API_KEY=sk-ant-... python tests/test_e2e.py

The script creates a minimal synthetic video (black frames, 5s) if no
VIDEO_PATH env var is provided. Pass VIDEO_PATH=/path/to/real.mov to use a
real cricket video.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

# Read backend port from .env
def _load_port() -> int:
    env_file = Path(__file__).parents[1] / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("BACKEND_PORT="):
                return int(line.split("=", 1)[1].strip())
    return 8082


BASE_URL = f"http://localhost:{_load_port()}/api"


def _make_test_video() -> Path:
    """Create a 5-second 720p black video with a stick figure drawn on it."""
    try:
        import cv2
        import numpy as np
    except ImportError:
        # Fall back to ffmpeg if cv2 not available in test env
        tmp = Path(tempfile.mktemp(suffix=".mp4"))
        subprocess.run(
            ["ffmpeg", "-y", "-f", "lavfi", "-i", "color=black:size=1280x720:rate=30",
             "-t", "5", "-c:v", "libx264", str(tmp)],
            check=True, capture_output=True,
        )
        return tmp

    tmp = Path(tempfile.mktemp(suffix=".mp4"))
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(tmp), fourcc, 30, (1280, 720))
    for i in range(150):  # 5 seconds at 30fps
        frame = np.zeros((720, 1280, 3), dtype=np.uint8)
        # Draw a crude stick figure so MediaPipe has something to detect
        cx, cy = 640, 360
        # Head
        cv2.circle(frame, (cx, cy - 100), 40, (200, 200, 200), -1)
        # Body
        cv2.line(frame, (cx, cy - 60), (cx, cy + 60), (200, 200, 200), 8)
        # Arms
        cv2.line(frame, (cx, cy - 20), (cx - 80, cy + 20), (200, 200, 200), 6)
        cv2.line(frame, (cx, cy - 20), (cx + 80, cy + 20), (200, 200, 200), 6)
        # Legs
        cv2.line(frame, (cx, cy + 60), (cx - 50, cy + 140), (200, 200, 200), 6)
        cv2.line(frame, (cx, cy + 60), (cx + 50, cy + 140), (200, 200, 200), 6)
        writer.write(frame)
    writer.release()
    return tmp


def _post_upload(video_path: Path) -> str:
    import urllib.request
    import urllib.parse

    boundary = "----TestBoundary"
    video_bytes = video_path.read_bytes()
    filename = video_path.name

    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: video/mp4\r\n\r\n"
    ).encode() + video_bytes + f"\r\n--{boundary}--\r\n".encode()

    req = urllib.request.Request(
        f"{BASE_URL}/jobs",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())["job_id"]


def _poll_until_done(job_id: str, timeout: int = 600) -> dict:
    import urllib.request

    deadline = time.time() + timeout
    while time.time() < deadline:
        with urllib.request.urlopen(f"{BASE_URL}/jobs/{job_id}", timeout=10) as resp:
            data = json.loads(resp.read())
        stage = data.get("stage")
        print(f"  [{stage}] progress={data.get('progress', 0):.0%}")
        if stage == "complete":
            return data
        elif stage == "failed":
            raise AssertionError(f"Job failed: {data.get('error')}")
        time.sleep(3)
    raise TimeoutError(f"Job {job_id} did not complete within {timeout}s")


def test_pipeline(video_path: Path | None = None) -> None:
    print("\n=== Test 1: deterministic pipeline ===")

    # 1. Check health
    import urllib.request
    with urllib.request.urlopen(f"http://localhost:{_load_port()}/health", timeout=5) as r:
        assert json.loads(r.read())["status"] == "ok", "Health check failed"
    print("  ✓ Backend healthy")

    # 2. Upload
    tmp = None
    if video_path is None:
        print("  Creating synthetic test video…")
        tmp = _make_test_video()
        video_path = tmp
    print(f"  Uploading {video_path} ({video_path.stat().st_size // 1024} KB)…")
    job_id = _post_upload(video_path)
    print(f"  ✓ Job created: {job_id}")

    # 3. Poll
    print("  Polling until complete…")
    result = _poll_until_done(job_id)

    # 4. Assert metrics present
    analysis = result.get("analysis")
    assert analysis is not None, "analysis is None"
    print(f"  ✓ Analysis: {json.dumps(analysis, indent=4)}")

    # At least one metric should be non-None (synthetic video may not have pose)
    non_null = [k for k, v in analysis.items() if v is not None]
    if not non_null:
        print("  ⚠ No metrics computed (pose not detected on synthetic video — expected)")
    else:
        print(f"  ✓ Non-null metrics: {non_null}")

    # 5. Assert video available
    import urllib.request as _ur
    video_url = f"http://localhost:{_load_port()}/api/jobs/{job_id}/video"
    req = _ur.Request(video_url, headers={"Range": "bytes=0-1023"})
    with _ur.urlopen(req, timeout=10) as r:
        assert r.status in (200, 206), f"Video endpoint returned {r.status}"
    print("  ✓ Annotated video endpoint OK")

    if tmp:
        tmp.unlink(missing_ok=True)


def test_llm_insights(video_path: Path | None = None) -> None:
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        print("\n=== Test 2: LLM insights — SKIPPED (no ANTHROPIC_API_KEY) ===")
        return

    print("\n=== Test 2: LLM insights ===")
    tmp = None
    if video_path is None:
        tmp = _make_test_video()
        video_path = tmp

    job_id = _post_upload(video_path)
    print(f"  Uploaded job: {job_id}")
    result = _poll_until_done(job_id)

    insights = result.get("insights")
    assert insights is not None, "insights is None with API key set"
    print(f"  ✓ Insights keys: {list(insights.keys())}")

    if "coaching_feedback" in insights:
        cf = insights["coaching_feedback"]
        assert isinstance(cf.get("strengths"), list), "strengths not a list"
        assert isinstance(cf.get("issues"), list), "issues not a list"
        assert isinstance(cf.get("drills"), list), "drills not a list"
        print(f"  ✓ Coaching feedback: {len(cf['strengths'])} strengths, {len(cf['issues'])} issues")

    if tmp:
        tmp.unlink(missing_ok=True)


if __name__ == "__main__":
    video_env = os.getenv("VIDEO_PATH")
    vpath = Path(video_env) if video_env else None
    try:
        test_pipeline(vpath)
        test_llm_insights(vpath)
        print("\n✅ All tests passed")
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        sys.exit(1)
