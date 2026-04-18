"""Conversational agent: discusses video insights and can trigger re-analysis."""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

from app.config import ANTHROPIC_API_KEY

log = logging.getLogger(__name__)

SONNET = "claude-sonnet-4-6"

_SYSTEM = """You are an expert cricket coaching assistant analysing a specific batting video.
You have access to the biomechanical metrics and AI-generated insights for this video.
Your role is to:
- Discuss the technique observations in plain language
- Answer questions about the metrics and what they mean
- Accept corrections from the user (e.g. shot type misidentification)
- Suggest drills and improvements grounded in the data
- Recommend re-analysis when the user provides corrections that would change the insights

When the user corrects something important (like the shot type), acknowledge it and ask if
they would like to trigger a new analysis with this correction in mind.

If the user explicitly asks to re-analyse or re-run the analysis (in any phrasing), respond
with your reasoning AND include the exact token <ACTION:REANALYZE> somewhere in your response
so the system can detect and trigger it. Also include any corrections as
<CORRECTION:key=value> tokens, e.g. <CORRECTION:shot_type=cover drive>.

Keep responses concise and coaching-focused. Reference actual numbers from the metrics when
relevant."""


def _build_context(video_meta: dict, analysis: dict | None, insights: dict | None) -> str:
    parts = [f"Video: {video_meta.get('filename', 'unknown')}"]

    if analysis:
        parts.append("\nBiomechanical Metrics:")
        metric_labels = {
            "stance_width_normalized": "Stance width (× shoulder width)",
            "head_stillness_variance": "Head stillness variance (px²)",
            "backlift_peak_height": "Backlift peak height (px above shoulder)",
            "front_foot_stride_length": "Front-foot stride (× shoulder width)",
            "impact_frame": "Impact frame",
            "head_over_front_foot": "Head over front foot at impact (px)",
        }
        for k, label in metric_labels.items():
            v = analysis.get(k)
            if v is not None:
                parts.append(f"  {label}: {round(v, 2) if isinstance(v, float) else v}")

    if insights:
        cf = insights.get("coaching_feedback")
        if cf:
            parts.append("\nCoaching Feedback:")
            for s in cf.get("strengths", []):
                parts.append(f"  Strength: {s}")
            for s in cf.get("issues", []):
                parts.append(f"  Issue: {s}")
            for s in cf.get("drills", []):
                parts.append(f"  Drill: {s}")

        sc = insights.get("shot_classification")
        if sc:
            parts.append(f"\nShot Classification: {sc.get('shot_type')} "
                         f"({sc.get('confidence')} confidence) — {sc.get('reasoning')}")

        vr = insights.get("vision_review") or []
        for frame in vr:
            parts.append(f"\nFrame '{frame.get('frame_label')}' observations:")
            for obs in frame.get("observations", []):
                parts.append(f"  • {obs}")

    return "\n".join(parts)


def chat(
    video_meta: dict,
    analysis: dict | None,
    insights: dict | None,
    history: list[dict],
    user_message: str,
) -> dict:
    """
    Send a user message and return assistant reply dict:
    {role, content, ts, action, corrections}
    """
    if not ANTHROPIC_API_KEY:
        return {
            "role": "assistant",
            "content": "AI chat is not available — no ANTHROPIC_API_KEY configured.",
            "ts": time.time(),
            "action": None,
            "corrections": {},
        }

    import anthropic
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    context = _build_context(video_meta, analysis, insights)
    system_prompt = _SYSTEM + f"\n\n---\nCURRENT VIDEO CONTEXT:\n{context}\n---"

    messages = []
    for msg in history:
        if msg.get("type") == "message" and msg.get("role") in ("user", "assistant"):
            messages.append({"role": msg["role"], "content": msg["content"]})

    messages.append({"role": "user", "content": user_message})

    try:
        response = client.messages.create(
            model=SONNET,
            max_tokens=1024,
            system=system_prompt,
            messages=messages,
        )
        content = response.content[0].text

        # Parse special action tokens
        action = None
        corrections: dict = {}

        if "<ACTION:REANALYZE>" in content:
            action = "reanalyze"
            content = content.replace("<ACTION:REANALYZE>", "").strip()

        import re
        for m in re.finditer(r"<CORRECTION:(\w+)=([^>]+)>", content):
            corrections[m.group(1)] = m.group(2).strip()
            content = content.replace(m.group(0), "").strip()

        return {
            "role": "assistant",
            "content": content,
            "ts": time.time(),
            "action": action,
            "corrections": corrections,
        }
    except Exception as e:
        log.error("Chat agent error: %s", e)
        return {
            "role": "assistant",
            "content": f"Sorry, I encountered an error: {e}",
            "ts": time.time(),
            "action": None,
            "corrections": {},
        }
