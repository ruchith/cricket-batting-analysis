"""FastAPI application entry point."""
from __future__ import annotations

import logging
import os
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import BACKEND_PORT, REDIS_HOST, REDIS_PORT

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stdout,
)
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
app.include_router(router)


@app.get("/health")
async def health():
    return {"status": "ok"}
