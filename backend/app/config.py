import os
from pathlib import Path
from dotenv import load_dotenv

# Load from repo root .env
_repo_root = Path(__file__).resolve().parents[3]
load_dotenv(_repo_root / ".env")

BACKEND_PORT: int = int(os.getenv("BACKEND_PORT", "8082"))
REDIS_PORT: int = int(os.getenv("REDIS_PORT", "6382"))
REDIS_HOST: str = os.getenv("REDIS_HOST", "localhost")
REDIS_URL: str = f"redis://{REDIS_HOST}:{REDIS_PORT}"

DATA_DIR: Path = Path(os.getenv("DATA_DIR", "./data")).resolve()
JOBS_DIR: Path = DATA_DIR / "jobs"
FEEDBACK_FILE: Path = DATA_DIR / "llm_feedback.jsonl"

ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")

# Ensure dirs exist at import time
JOBS_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR.mkdir(parents=True, exist_ok=True)
