"""Single module for all LLM interactions. Returns None/empty when no API key."""
from __future__ import annotations

import base64
import json
import logging
import time
from pathlib import Path
from typing import Any

from app.config import ANTHROPIC_API_KEY

log = logging.getLogger(__name__)

HAIKU = "claude-haiku-4-5-20251001"
SONNET = "claude-sonnet-4-6"

_client: Any = None


def _get_client():
    global _client
    if _client is None and ANTHROPIC_API_KEY:
        import anthropic
        _client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    return _client


def _log_llm(job_dir: Path, role: str, model: str, prompt: Any, response: Any) -> None:
    log_file = job_dir / "llm_log.jsonl"
    entry = {
        "ts": time.time(),
        "role": role,
        "model": model,
        "prompt": prompt,
        "response": response,
    }
    with log_file.open("a") as f:
        f.write(json.dumps(entry) + "\n")


def _call_with_retry(fn, *args, retries: int = 3, **kwargs):
    import anthropic
    for attempt in range(retries):
        try:
            return fn(*args, **kwargs)
        except (anthropic.RateLimitError, anthropic.APIStatusError) as e:
            if attempt == retries - 1:
                raise
            wait = 2 ** attempt
            log.warning("LLM error %s, retrying in %ds", e, wait)
            time.sleep(wait)


def generate_coaching_feedback(
    job_dir: Path, metrics: dict, chat_context: str | None = None
) -> dict | None:
    client = _get_client()
    if not client:
        return None

    context_block = (
        f"\nPREVIOUS USER FEEDBACK (from chat — treat as ground truth):\n{chat_context}\n"
        if chat_context else ""
    )

    prompt = f"""You are an expert cricket batting coach. Below are biomechanical metrics
computed from a video analysis. Provide coaching feedback STRICTLY based on these numbers.
Do NOT invent measurements or reference values not provided below.
{context_block}
METRICS:
{json.dumps(metrics, indent=2)}

Respond with valid JSON matching this exact schema:
{{
  "strengths": ["<strength 1>", ...],
  "issues": ["<issue 1>", ...],
  "drills": ["<drill 1>", ...]
}}

Use 2-4 items per list. Be specific and actionable. Mention the actual metric values.
If previous user feedback contradicts or refines the metrics, prioritise the user's account."""

    try:
        response = _call_with_retry(
            client.messages.create,
            model=HAIKU,
            max_tokens=600,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text.strip()
        # Extract JSON block if wrapped in markdown
        if "```" in text:
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        result = json.loads(text)
        _log_llm(job_dir, "coaching_feedback", HAIKU, prompt, result)
        return result
    except Exception as e:
        log.error("Coaching feedback LLM error: %s", e)
        _log_llm(job_dir, "coaching_feedback", HAIKU, prompt, {"error": str(e)})
        return None


def classify_shot(
    job_dir: Path, pose_summary: str, chat_context: str | None = None
) -> dict | None:
    client = _get_client()
    if not client:
        return None

    context_block = (
        f"\nPREVIOUS USER FEEDBACK (treat any shot-type correction as authoritative):\n{chat_context}\n"
        if chat_context else ""
    )

    prompt = f"""You are an expert cricket analyst. Below is a summary of a batter's
pose trajectory at 10 key frames (joint angles in degrees).
{context_block}
{pose_summary}

Based on the pose kinematics (and any user correction above), classify the shot being played.
Choose from: cover drive, straight drive, on drive, pull shot, hook shot, cut shot,
sweep shot, defensive push, forward defensive, backward defensive, flick, glance.

Respond with valid JSON:
{{
  "shot_type": "<shot name>",
  "confidence": "high|medium|low",
  "reasoning": "<1-2 sentence explanation>"
}}"""

    try:
        response = _call_with_retry(
            client.messages.create,
            model=SONNET,
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text.strip()
        if "```" in text:
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        result = json.loads(text)
        _log_llm(job_dir, "shot_classification", SONNET, prompt, result)
        return result
    except Exception as e:
        log.error("Shot classification LLM error: %s", e)
        _log_llm(job_dir, "shot_classification", SONNET, prompt, {"error": str(e)})
        return None


def vision_review_frames(job_dir: Path, frames: list[dict]) -> list[dict] | None:
    """frames: list of {label: str, path: Path}"""
    client = _get_client()
    if not client:
        return None

    content = []
    for frame in frames:
        img_path = Path(frame["path"])
        if not img_path.exists():
            continue
        img_b64 = base64.standard_b64encode(img_path.read_bytes()).decode()
        content.append({
            "type": "text",
            "text": f"Frame: {frame['label']}",
        })
        content.append({
            "type": "image",
            "source": {"type": "base64", "media_type": "image/jpeg", "data": img_b64},
        })

    if not content:
        return None

    content.append({
        "type": "text",
        "text": """As an expert cricket batting coach, analyze these key frames.
Focus on what pose keypoints miss: bat face angle, eye level relative to ball trajectory,
weight transfer cues, head position, grip, and footwork quality.

Respond with valid JSON array:
[
  {
    "frame_label": "<label>",
    "observations": ["<obs 1>", "<obs 2>", ...]
  }
]

Provide 3-5 observations per frame. Be specific about what you observe.""",
    })

    try:
        response = _call_with_retry(
            client.messages.create,
            model=SONNET,
            max_tokens=2048,
            messages=[{"role": "user", "content": content}],
        )
        text = response.content[0].text.strip()
        if "```" in text:
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        result = json.loads(text)
        _log_llm(job_dir, "vision_review", SONNET, [f["label"] for f in frames], result)
        return result
    except Exception as e:
        log.error("Vision review LLM error: %s", e)
        _log_llm(job_dir, "vision_review", SONNET, [f["label"] for f in frames], {"error": str(e)})
        return None
