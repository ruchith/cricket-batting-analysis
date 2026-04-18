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
  llm_enabled: boolean;
}

// ── Library types ─────────────────────────────────────────────────────────────

export interface ShotSegmentation {
  shot_start_frame: number;
  shot_end_frame: number;
  shot_start_ts: number;
  shot_end_ts: number;
  peak_frame: number;
  peak_ts: number;
  method: string;
}

export interface FrameConfidence {
  frame: number;
  ts: number;
  confidence: number;
  detected: boolean;
}

export interface AnalysisSummary {
  analysis_id: string;
  stage: Stage;
  progress: number;
  created_at: number;
  has_annotated_video: boolean;
  has_llm_insights: boolean;
  error?: string;
  analysis?: StanceMetrics;
  insights?: Insights;
  segmentation?: ShotSegmentation;
  confidence?: FrameConfidence[];
  llm_enabled?: boolean;
}

export interface VideoMeta {
  video_id: string;
  filename: string;
  created_at: number;
  analyses: AnalysisSummary[];
  conversations: ConversationMeta[];
  conversation_count?: number;
  llm_enabled?: boolean;
}

export interface ConversationMeta {
  conv_id: string;
  title: string;
  created_at: number;
  message_count: number;
  last_message: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  ts: number;
  action?: string;
}

export interface Conversation {
  conv_id: string;
  title: string;
  created_at: number;
  messages: ChatMessage[];
}

export interface SendMessageResponse {
  reply: string;
  action?: string;
  corrections?: Record<string, string>;
  triggered_analysis_id?: string;
}
