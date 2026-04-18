"""Stage 1: save uploaded file to job dir as raw.mov"""
from pathlib import Path
import shutil


async def run(job_dir: Path, upload_path: Path) -> Path:
    raw = job_dir / "raw.mov"
    shutil.copy2(upload_path, raw)
    return raw
