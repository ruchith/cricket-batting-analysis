"""arq WorkerSettings — imported by `arq` CLI."""
from arq.connections import RedisSettings
from app.config import REDIS_HOST, REDIS_PORT, DATA_DIR
from app.logging_config import configure
from app.worker.tasks import process_video

configure(DATA_DIR.parent / "logs", "worker")


class WorkerSettings:
    functions = [process_video]
    redis_settings = RedisSettings(host=REDIS_HOST, port=REDIS_PORT)
    max_jobs = 4
    job_timeout = 1800  # 30 min — long videos with GPU pose
