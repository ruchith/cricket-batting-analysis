export type Stage =
  | "queued"
  | "ingest"
  | "normalize"
  | "pose"
  | "metrics"
  | "render"
  | "llm"
  | "complete"
  | "failed";

export interface StanceMetrics {
  stance_width_normalized: number | null;
  head_stillness_variance: number | null;
  backlift_peak_height: number | null;
  front_foot_stride_length: number | null;
  impact_frame: number | null;
  head_over_front_foot: number | null;
}

export interface CoachingFeedback {
  strengths: string[];
  issues: string[];
  drills: string[];
}

export interface ShotClassification {
  shot_type: string;
  confidence: "high" | "medium" | "low";
  reasoning: string;
}

export interface FrameObservation {
  frame_label: string;
  observations: string[];
}

export interface Insights {
  coaching_feedback?: CoachingFeedback;
  shot_classification?: ShotClassification;
  vision_review?: FrameObservation[];
  impact_vision?: FrameObservation[];
}

export interface JobResponse {
  job_id: string;
  stage: Stage;
  progress: number;
  error?: string;
  analysis?: StanceMetrics;
  insights?: Insights;
  has_annotated_video: boolean;
  has_llm_insights: boolean;
}
