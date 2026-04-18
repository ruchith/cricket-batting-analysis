from __future__ import annotations
from enum import Enum
from typing import Any
from pydantic import BaseModel


class Stage(str, Enum):
    queued = "queued"
    ingest = "ingest"
    normalize = "normalize"
    pose = "pose"
    metrics = "metrics"
    render = "render"
    llm = "llm"
    complete = "complete"
    failed = "failed"


class StanceMetrics(BaseModel):
    stance_width_normalized: float | None = None
    head_stillness_variance: float | None = None
    backlift_peak_height: float | None = None
    front_foot_stride_length: float | None = None
    impact_frame: int | None = None
    head_over_front_foot: float | None = None


class JobStatus(BaseModel):
    job_id: str
    stage: Stage
    progress: float = 0.0  # 0-1
    error: str | None = None
    analysis: StanceMetrics | None = None
    insights: dict[str, Any] | None = None
    has_annotated_video: bool = False
    has_llm_insights: bool = False


class ImpactRequest(BaseModel):
    frame_index: int


class FeedbackRequest(BaseModel):
    insight_id: str
    useful: bool


class CoachingFeedback(BaseModel):
    strengths: list[str]
    issues: list[str]
    drills: list[str]


class ShotClassification(BaseModel):
    shot_type: str
    confidence: str
    reasoning: str


class FrameObservation(BaseModel):
    frame_label: str
    observations: list[str]


class Insights(BaseModel):
    coaching_feedback: CoachingFeedback | None = None
    shot_classification: ShotClassification | None = None
    vision_review: list[FrameObservation] | None = None
    impact_vision: list[FrameObservation] | None = None
