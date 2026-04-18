"""Summarise conversation history for a video into coaching context.

Reads all JSONL conversation files, extracts user/assistant messages,
and calls Claude Haiku to produce a concise paragraph that highlights
corrections, identified errors, and user observations. This summary is
injected into subsequent analysis LLM prompts so the pipeline can take
user feedback into account.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

log = logging.getLogger(__name__)

_SUMMARY_PROMPT = """\
You are helping prepare context for a cricket batting re-analysis.
Below are excerpts from the coach-athlete chat about a previous analysis.

Your task: write a single concise paragraph (3-5 sentences) summarising
the key feedback, corrections, and observations the user provided.
Focus on:
- Any shot-type corrections (e.g. "it's a cover drive, not a pull shot")
- Technique issues the user identified or disputed
- Positive observations the user confirmed
- Any explicit instructions for the next analysis

Do NOT add opinions of your own. Only reflect what the user said.
If there is nothing substantive to summarise, respond with exactly: NONE

CONVERSATION HISTORY:
{history}
"""


def generate_chat_summary(video_id: str) -> str | None:
    """
    Return a short coaching-context paragraph from all conversations for
    this video, or None if there are no messages or no API key.
    """
    from app.config import ANTHROPIC_API_KEY
    from app.library import list_conversations, get_conversation

    if not ANTHROPIC_API_KEY:
        return None

    convs = list_conversations(video_id)
    if not convs:
        return None

    # Collect all user and assistant messages across conversations
    lines: list[str] = []
    for meta in convs:
        conv = get_conversation(video_id, meta["conv_id"])
        if not conv:
            continue
        for msg in conv.get("messages", []):
            role = msg.get("role", "")
            content = msg.get("content", "").strip()
            if role in ("user", "assistant") and content:
                label = "User" if role == "user" else "Assistant"
                lines.append(f"{label}: {content}")

    if not lines:
        return None

    history_text = "\n".join(lines)
    prompt = _SUMMARY_PROMPT.format(history=history_text)

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text.strip()
        if text.upper() == "NONE" or not text:
            return None
        log.info("Chat summary generated (%d chars) for video %s", len(text), video_id)
        return text
    except Exception as e:
        log.warning("Chat summary generation failed: %s", e)
        return None
