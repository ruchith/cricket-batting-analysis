"""Library: persistent per-video storage, analysis versioning, conversations."""
from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any

from app.config import DATA_DIR

LIBRARY_DIR: Path = DATA_DIR.parent / "library"
LIBRARY_DIR.mkdir(parents=True, exist_ok=True)


# ── Path helpers ──────────────────────────────────────────────────────────────

def video_dir(video_id: str) -> Path:
    return LIBRARY_DIR / video_id

def analyses_dir(video_id: str) -> Path:
    return video_dir(video_id) / "analyses"

def analysis_dir(video_id: str, analysis_id: str) -> Path:
    return analyses_dir(video_id) / analysis_id

def conversations_dir(video_id: str) -> Path:
    return video_dir(video_id) / "conversations"

def conversation_path(video_id: str, conv_id: str) -> Path:
    return conversations_dir(video_id) / f"{conv_id}.jsonl"


# ── Video lifecycle ───────────────────────────────────────────────────────────

def create_video(filename: str) -> str:
    video_id = str(uuid.uuid4())
    vdir = video_dir(video_id)
    vdir.mkdir(parents=True)
    analyses_dir(video_id).mkdir()
    conversations_dir(video_id).mkdir()
    meta = {
        "video_id": video_id,
        "filename": filename,
        "created_at": time.time(),
    }
    (vdir / "meta.json").write_text(json.dumps(meta, indent=2))
    return video_id


def get_video_meta(video_id: str) -> dict | None:
    p = video_dir(video_id) / "meta.json"
    return json.loads(p.read_text()) if p.exists() else None


def list_videos() -> list[dict]:
    videos = []
    if not LIBRARY_DIR.exists():
        return videos
    for d in sorted(LIBRARY_DIR.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
        if (d / "meta.json").exists():
            meta = json.loads((d / "meta.json").read_text())
            meta["analyses"] = _list_analyses_summary(d.name)
            meta["conversation_count"] = len(list_conversations(d.name))
            videos.append(meta)
    return videos


def delete_video(video_id: str) -> bool:
    import shutil
    vdir = video_dir(video_id)
    if not vdir.exists():
        return False
    shutil.rmtree(vdir)
    return True


# ── Analysis lifecycle ────────────────────────────────────────────────────────

def create_analysis(video_id: str) -> str:
    analysis_id = str(uuid.uuid4())
    adir = analysis_dir(video_id, analysis_id)
    adir.mkdir(parents=True)
    status = {"stage": "queued", "progress": 0.0, "created_at": time.time()}
    (adir / "status.json").write_text(json.dumps(status))
    return analysis_id


def get_analysis(video_id: str, analysis_id: str) -> dict | None:
    adir = analysis_dir(video_id, analysis_id)
    status_file = adir / "status.json"
    if not status_file.exists():
        return None

    status = json.loads(status_file.read_text())
    analysis_data = None
    insights_data = None

    af = adir / "analysis.json"
    if af.exists():
        analysis_data = json.loads(af.read_text())

    inf = adir / "insights.json"
    if inf.exists():
        raw = json.loads(inf.read_text())
        insights_data = raw if raw else None

    return {
        "analysis_id": analysis_id,
        "stage": status.get("stage"),
        "progress": status.get("progress", 0.0),
        "created_at": status.get("created_at", 0),
        "error": status.get("error"),
        "analysis": analysis_data,
        "insights": insights_data,
        "has_annotated_video": (adir / "annotated.mp4").exists(),
        "has_llm_insights": bool(insights_data),
    }


def _list_analyses_summary(video_id: str) -> list[dict]:
    adir = analyses_dir(video_id)
    results = []
    if not adir.exists():
        return results
    for d in sorted(adir.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
        sf = d / "status.json"
        if sf.exists():
            s = json.loads(sf.read_text())
            results.append({
                "analysis_id": d.name,
                "stage": s.get("stage"),
                "progress": s.get("progress", 0.0),
                "created_at": s.get("created_at", 0),
                "has_annotated_video": (d / "annotated.mp4").exists(),
                "has_llm_insights": bool((d / "insights.json").exists() and
                                         json.loads((d / "insights.json").read_text())),
            })
    return results


def delete_analysis(video_id: str, analysis_id: str) -> bool:
    import shutil
    adir = analysis_dir(video_id, analysis_id)
    if not adir.exists():
        return False
    shutil.rmtree(adir)
    return True


# ── Conversation lifecycle ────────────────────────────────────────────────────

def create_conversation(video_id: str, title: str = "") -> str:
    conv_id = str(uuid.uuid4())
    cdir = conversations_dir(video_id)
    cdir.mkdir(parents=True, exist_ok=True)
    meta_entry = {
        "type": "meta",
        "conv_id": conv_id,
        "title": title or "New conversation",
        "created_at": time.time(),
    }
    with conversation_path(video_id, conv_id).open("w") as f:
        f.write(json.dumps(meta_entry) + "\n")
    return conv_id


def list_conversations(video_id: str) -> list[dict]:
    cdir = conversations_dir(video_id)
    convs = []
    if not cdir.exists():
        return convs
    for p in sorted(cdir.glob("*.jsonl"), key=lambda x: x.stat().st_mtime, reverse=True):
        lines = [json.loads(l) for l in p.read_text().splitlines() if l.strip()]
        if not lines:
            continue
        meta_line = next((l for l in lines if l.get("type") == "meta"), {})
        messages = [l for l in lines if l.get("type") == "message"]
        convs.append({
            "conv_id": p.stem,
            "title": meta_line.get("title", "Untitled"),
            "created_at": meta_line.get("created_at", 0),
            "message_count": len(messages),
            "last_message": messages[-1].get("content", "")[:80] if messages else "",
        })
    return convs


def get_conversation(video_id: str, conv_id: str) -> dict | None:
    p = conversation_path(video_id, conv_id)
    if not p.exists():
        return None
    lines = [json.loads(l) for l in p.read_text().splitlines() if l.strip()]
    meta_line = next((l for l in lines if l.get("type") == "meta"), {})
    messages = [l for l in lines if l.get("type") == "message"]
    return {
        "conv_id": conv_id,
        "title": meta_line.get("title", "Untitled"),
        "created_at": meta_line.get("created_at", 0),
        "messages": messages,
    }


def append_message(video_id: str, conv_id: str, role: str, content: str,
                   action: str | None = None) -> dict:
    msg: dict[str, Any] = {
        "type": "message",
        "role": role,
        "content": content,
        "ts": time.time(),
    }
    if action:
        msg["action"] = action
    with conversation_path(video_id, conv_id).open("a") as f:
        f.write(json.dumps(msg) + "\n")
    return msg


def delete_conversation(video_id: str, conv_id: str) -> bool:
    p = conversation_path(video_id, conv_id)
    if not p.exists():
        return False
    p.unlink()
    return True


def update_conversation_title(video_id: str, conv_id: str, title: str) -> None:
    p = conversation_path(video_id, conv_id)
    if not p.exists():
        return
    lines = p.read_text().splitlines()
    updated = []
    for line in lines:
        entry = json.loads(line)
        if entry.get("type") == "meta":
            entry["title"] = title
        updated.append(json.dumps(entry))
    p.write_text("\n".join(updated) + "\n")
