"""FastAPI application entry point."""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import BACKEND_PORT, REDIS_HOST, REDIS_PORT, DATA_DIR
from app.logging_config import configure

configure(DATA_DIR.parent / "logs", "backend")
log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    from arq import create_pool
    from arq.connections import RedisSettings

    pool = await create_pool(RedisSettings(host=REDIS_HOST, port=REDIS_PORT))
    app.state.arq_pool = pool
    log.info("Connected to Redis at %s:%d", REDIS_HOST, REDIS_PORT)

    frontend_port = int(os.getenv("FRONTEND_PORT", "3009"))
    log.info("=" * 60)
    log.info("  Cricket Batting Analysis — Backend")
    log.info("  API:      http://localhost:%d", BACKEND_PORT)
    log.info("  Docs:     http://localhost:%d/docs", BACKEND_PORT)
    log.info("  Frontend: http://localhost:%d", frontend_port)
    log.info("=" * 60)

    yield

    await pool.close()


app = FastAPI(title="Cricket Batting Analysis", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

from app.api.routes import router
from app.api.video_routes import router as video_router
app.include_router(router)
app.include_router(video_router)


@app.get("/health")
async def health():
    return {"status": "ok"}


# ── SPA static file serving (production build) ────────────────────────────────

_FRONTEND_DIST = Path(__file__).parent.parent.parent.parent / "frontend" / "dist"

if _FRONTEND_DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=_FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        return FileResponse(_FRONTEND_DIST / "index.html")
