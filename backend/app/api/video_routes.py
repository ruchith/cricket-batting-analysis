"""Video library + chat API routes."""
from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path

import aiofiles
from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel

from app.config import ANTHROPIC_API_KEY
from app.library import (
    LIBRARY_DIR,
    analyses_dir,
    analysis_dir,
    append_message,
    create_analysis,
    create_conversation,
    create_video,
    delete_analysis,
    delete_conversation,
    delete_video,
    get_analysis,
    get_conversation,
    get_video_meta,
    list_conversations,
    list_videos,
    update_conversation_title,
    video_dir,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/videos")

_UPLOAD_CHUNK = 1024 * 1024


# ── Video upload ──────────────────────────────────────────────────────────────

@router.post("")
async def upload_video(request: Request, file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith((".mov", ".mp4")):
        raise HTTPException(400, "Only .mov and .mp4 files are accepted")

    video_id = create_video(file.filename)
    vdir = video_dir(video_id)

    # Save original
    suffix = Path(file.filename).suffix
    original_path = vdir / f"original{suffix}"
    async with aiofiles.open(original_path, "wb") as f:
        while chunk := await file.read(_UPLOAD_CHUNK):
            await f.write(chunk)

    # Create first analysis and enqueue
    analysis_id = create_analysis(video_id)
    pool = request.app.state.arq_pool
    job_id = str(uuid.uuid4())
    await pool.enqueue_job(
        "process_video", job_id, str(original_path),
        video_id=video_id, analysis_id=analysis_id,
    )
    log.info("New video %s, analysis %s enqueued", video_id, analysis_id)
    return {"video_id": video_id, "analysis_id": analysis_id}


# ── Video list / detail / delete ──────────────────────────────────────────────

@router.get("")
async def list_all_videos():
    return {"videos": list_videos()}


@router.get("/{video_id}")
async def get_video(video_id: str):
    meta = _require_video(video_id)
    meta["analyses"] = [
        get_analysis(video_id, d.name)
        for d in sorted(analyses_dir(video_id).iterdir(), key=lambda x: x.stat().st_mtime, reverse=True)
        if d.is_dir()
    ]
    meta["conversations"] = list_conversations(video_id)
    meta["llm_enabled"] = bool(ANTHROPIC_API_KEY)
    return meta


@router.delete("/{video_id}")
async def remove_video(video_id: str):
    _require_video(video_id)
    delete_video(video_id)
    return {"ok": True}


# ── Analysis CRUD + re-run ────────────────────────────────────────────────────

class RerunBody(BaseModel):
    corrections: dict = {}
    include_chat_summary: bool = True


@router.post("/{video_id}/analyses")
async def rerun_analysis(video_id: str, request: Request, body: RerunBody = RerunBody()):
    _require_video(video_id)

    candidates = list(video_dir(video_id).glob("original.*"))
    if not candidates:
        raise HTTPException(400, "No original video stored for this entry")

    chat_context: str | None = None
    if body.include_chat_summary:
        from app.pipeline.chat_summary import generate_chat_summary
        chat_context = generate_chat_summary(video_id)
        if chat_context:
            log.info("Chat summary included for re-analysis of video %s", video_id)
        else:
            log.info("No chat summary available for video %s", video_id)

    analysis_id = create_analysis(video_id)
    pool = request.app.state.arq_pool
    job_id = str(uuid.uuid4())
    await pool.enqueue_job(
        "process_video", job_id, str(candidates[0]),
        video_id=video_id, analysis_id=analysis_id,
        corrections=body.corrections,
        chat_context=chat_context,
    )
    log.info("Re-analysis %s for video %s (corrections=%s, chat_context=%s)",
             analysis_id, video_id, body.corrections, bool(chat_context))
    return {"analysis_id": analysis_id}


@router.get("/{video_id}/analyses/{analysis_id}")
async def get_analysis_detail(video_id: str, analysis_id: str):
    _require_video(video_id)
    result = get_analysis(video_id, analysis_id)
    if not result:
        raise HTTPException(404, "Analysis not found")
    result["llm_enabled"] = bool(ANTHROPIC_API_KEY)
    return result


@router.get("/{video_id}/analyses/{analysis_id}/report")
async def get_analysis_report(video_id: str, analysis_id: str):
    _require_video(video_id)
    detail = get_analysis(video_id, analysis_id)
    if not detail:
        raise HTTPException(404, "Analysis not found")
    video_meta = get_video_meta(video_id) or {}
    from app.pipeline.report import generate_report
    html = generate_report(
        video_meta=video_meta,
        analysis=detail.get("analysis"),
        insights=detail.get("insights"),
        segmentation=detail.get("segmentation"),
        analysis_id=analysis_id,
        analysis_dir=analysis_dir(video_id, analysis_id),
    )
    filename = video_meta.get("filename", "analysis").rsplit(".", 1)[0].replace(" ", "_")
    return HTMLResponse(
        content=html,
        headers={"Content-Disposition": f'attachment; filename="{filename}_report.html"'},
    )


@router.delete("/{video_id}/analyses/{analysis_id}")
async def remove_analysis(video_id: str, analysis_id: str):
    _require_video(video_id)
    if not delete_analysis(video_id, analysis_id):
        raise HTTPException(404, "Analysis not found")
    return {"ok": True}


@router.get("/{video_id}/analyses/{analysis_id}/video")
async def stream_analysis_video(video_id: str, analysis_id: str, request: Request):
    _require_video(video_id)
    video_path = analysis_dir(video_id, analysis_id) / "annotated.mp4"
    if not video_path.exists():
        raise HTTPException(404, "Annotated video not ready")
    return _range_stream(video_path, request)


@router.post("/{video_id}/analyses/{analysis_id}/impact")
async def mark_analysis_impact(video_id: str, analysis_id: str, body: dict):
    _require_video(video_id)
    adir = analysis_dir(video_id, analysis_id)
    kp_path = adir / "keypoints.jsonl"
    if not kp_path.exists():
        raise HTTPException(400, "Keypoints not ready")

    from app.pipeline.metrics import compute_metrics
    frame_index = body.get("frame_index")
    analysis = compute_metrics(kp_path, impact_frame=frame_index)
    (adir / "analysis.json").write_text(json.dumps(analysis, indent=2))

    if ANTHROPIC_API_KEY:
        import asyncio
        asyncio.create_task(_impact_vision_lib(video_id, analysis_id, frame_index))

    return {"analysis": analysis}


async def _impact_vision_lib(video_id: str, analysis_id: str, frame_index: int) -> None:
    import cv2
    from app.pipeline import llm_client
    adir = analysis_dir(video_id, analysis_id)
    video_path = adir / "normalized.mp4"
    if not video_path.exists():
        return
    frames_dir = adir / "key_frames"
    frames_dir.mkdir(exist_ok=True)
    frame_path = frames_dir / f"impact_{frame_index}.jpg"
    cap = cv2.VideoCapture(str(video_path))
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
    ok, frame = cap.read()
    cap.release()
    if not ok:
        return
    cv2.imwrite(str(frame_path), frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    vision = llm_client.vision_review_frames(
        adir, [{"label": f"impact_frame_{frame_index}", "path": str(frame_path)}]
    )
    if vision:
        insights_path = adir / "insights.json"
        existing = json.loads(insights_path.read_text()) if insights_path.exists() else {}
        existing["impact_vision"] = vision
        insights_path.write_text(json.dumps(existing, indent=2))


# ── Conversations ─────────────────────────────────────────────────────────────

class NewConversation(BaseModel):
    title: str = ""
    analysis_id: str | None = None


class SendMessage(BaseModel):
    content: str
    analysis_id: str | None = None  # which analysis to use as context


class RenameConversation(BaseModel):
    title: str


@router.get("/{video_id}/conversations")
async def list_video_conversations(video_id: str):
    _require_video(video_id)
    return {"conversations": list_conversations(video_id)}


@router.post("/{video_id}/conversations")
async def new_conversation(video_id: str, body: NewConversation):
    _require_video(video_id)
    conv_id = create_conversation(video_id, body.title)
    return {"conv_id": conv_id}


@router.get("/{video_id}/conversations/{conv_id}")
async def get_conv(video_id: str, conv_id: str):
    _require_video(video_id)
    conv = get_conversation(video_id, conv_id)
    if not conv:
        raise HTTPException(404, "Conversation not found")
    return conv


@router.patch("/{video_id}/conversations/{conv_id}")
async def rename_conv(video_id: str, conv_id: str, body: RenameConversation):
    _require_video(video_id)
    update_conversation_title(video_id, conv_id, body.title)
    return {"ok": True}


@router.delete("/{video_id}/conversations/{conv_id}")
async def remove_conversation(video_id: str, conv_id: str):
    _require_video(video_id)
    if not delete_conversation(video_id, conv_id):
        raise HTTPException(404, "Conversation not found")
    return {"ok": True}


@router.post("/{video_id}/conversations/{conv_id}/messages")
async def send_message(video_id: str, conv_id: str, body: SendMessage,
                       request: Request):
    _require_video(video_id)
    conv = get_conversation(video_id, conv_id)
    if not conv:
        raise HTTPException(404, "Conversation not found")

    # Resolve which analysis to use for context
    analysis_data = None
    insights_data = None
    if body.analysis_id:
        detail = get_analysis(video_id, body.analysis_id)
        if detail:
            analysis_data = detail.get("analysis")
            insights_data = detail.get("insights")
    else:
        # Use most recent completed analysis
        for d in sorted(analyses_dir(video_id).iterdir(),
                        key=lambda x: x.stat().st_mtime, reverse=True):
            af = d / "analysis.json"
            if af.exists():
                analysis_data = json.loads(af.read_text())
                inf = d / "insights.json"
                if inf.exists():
                    raw = json.loads(inf.read_text())
                    insights_data = raw if raw else None
                break

    video_meta = get_video_meta(video_id) or {}

    # Append user message
    append_message(video_id, conv_id, "user", body.content)

    # Update title from first user message if still default
    if conv.get("title") in ("New conversation", "Untitled", "") and conv.get("message_count", 0) == 0:
        title = body.content[:50] + ("…" if len(body.content) > 50 else "")
        update_conversation_title(video_id, conv_id, title)

    # Get conversation history for context
    updated_conv = get_conversation(video_id, conv_id)
    history = [m for m in (updated_conv or {}).get("messages", [])
               if m.get("role") != "assistant" or m != updated_conv["messages"][-1]]

    # Run chat agent
    from app.pipeline.chat_agent import chat
    reply = chat(video_meta, analysis_data, insights_data, history, body.content)

    # Append assistant reply
    append_message(video_id, conv_id, "assistant", reply["content"],
                   action=reply.get("action"))

    # If agent suggests re-analysis, auto-trigger it
    triggered_analysis_id = None
    if reply.get("action") == "reanalyze":
        candidates = list(video_dir(video_id).glob("original.*"))
        if candidates:
            corrections = reply.get("corrections", {})
            triggered_analysis_id = create_analysis(video_id)
            pool = request.app.state.arq_pool
            job_id = str(uuid.uuid4())
            await pool.enqueue_job(
                "process_video", job_id, str(candidates[0]),
                video_id=video_id, analysis_id=triggered_analysis_id,
                corrections=corrections,
            )
            log.info("Chat triggered re-analysis %s for video %s", triggered_analysis_id, video_id)

    return {
        "reply": reply["content"],
        "action": reply.get("action"),
        "corrections": reply.get("corrections", {}),
        "triggered_analysis_id": triggered_analysis_id,
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _require_video(video_id: str) -> dict:
    meta = get_video_meta(video_id)
    if not meta:
        raise HTTPException(404, f"Video {video_id} not found")
    return meta


def _range_stream(video_path: Path, request: Request) -> StreamingResponse:
    file_size = video_path.stat().st_size
    range_header = request.headers.get("range")

    if range_header:
        start, end = _parse_range(range_header, file_size)
        chunk_size = end - start + 1

        async def _iter():
            async with aiofiles.open(video_path, "rb") as f:
                await f.seek(start)
                remaining = chunk_size
                while remaining > 0:
                    data = await f.read(min(remaining, 65536))
                    if not data:
                        break
                    yield data
                    remaining -= len(data)

        return StreamingResponse(
            _iter(), status_code=206, media_type="video/mp4",
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(chunk_size),
            },
        )

    from fastapi.responses import FileResponse
    return FileResponse(video_path, media_type="video/mp4",
                        headers={"Accept-Ranges": "bytes"})


def _parse_range(header: str, file_size: int) -> tuple[int, int]:
    if not header.startswith("bytes="):
        raise HTTPException(416, "Invalid range")
    parts = header[6:].split("-")
    start = int(parts[0]) if parts[0] else 0
    end = int(parts[1]) if parts[1] else file_size - 1
    return start, min(end, file_size - 1)
