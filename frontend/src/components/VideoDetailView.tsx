import { useState, useEffect, useRef, useCallback } from "react";
import {
  getVideo, getAnalysis, rerunAnalysis, deleteAnalysis,
  analysisVideoUrl, markAnalysisImpact,
} from "../api";
import { ChatPanel } from "./ChatPanel";
import type { VideoMeta, AnalysisSummary, ConversationMeta, StanceMetrics, Insights } from "../types";

interface Props {
  videoId: string;
  initialAnalysisId?: string;
  onBack: () => void;
}

export function VideoDetailView({ videoId, initialAnalysisId, onBack }: Props) {
  const [video, setVideo] = useState<VideoMeta | null>(null);
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string | null>(
    initialAnalysisId ?? null
  );
  const [analysis, setAnalysis] = useState<AnalysisSummary | null>(null);
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [rerunning, setRerunning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadVideo = useCallback(async () => {
    const v = await getVideo(videoId);
    setVideo(v);
    setConversations(v.conversations ?? []);
    if (!selectedAnalysisId && v.analyses[0]) {
      setSelectedAnalysisId(v.analyses[0].analysis_id);
    }
  }, [videoId, selectedAnalysisId]);

  useEffect(() => { loadVideo(); }, [loadVideo]);

  const loadAnalysis = useCallback(async (aid: string) => {
    try {
      const a = await getAnalysis(videoId, aid);
      setAnalysis(a);
      return a;
    } catch {
      return null;
    }
  }, [videoId]);

  useEffect(() => {
    if (pollRef.current) clearTimeout(pollRef.current);
    if (!selectedAnalysisId) { setAnalysis(null); return; }

    loadAnalysis(selectedAnalysisId).then((a) => {
      if (a && a.stage !== "complete" && a.stage !== "failed") {
        const poll = () => {
          loadAnalysis(selectedAnalysisId).then((a2) => {
            if (a2 && a2.stage !== "complete" && a2.stage !== "failed") {
              pollRef.current = setTimeout(poll, 2000);
            } else {
              loadVideo();
            }
          });
        };
        pollRef.current = setTimeout(poll, 2000);
      }
    });

    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [selectedAnalysisId, loadAnalysis, loadVideo]);

  const handleRerun = useCallback(async () => {
    setRerunning(true);
    try {
      const { analysis_id } = await rerunAnalysis(videoId);
      await loadVideo();
      setSelectedAnalysisId(analysis_id);
    } finally {
      setRerunning(false);
    }
  }, [videoId, loadVideo]);

  const handleDeleteAnalysis = useCallback(async () => {
    if (!selectedAnalysisId) return;
    if (!confirm("Delete this analysis?")) return;
    setDeleting(true);
    try {
      await deleteAnalysis(videoId, selectedAnalysisId);
      await loadVideo();
      setSelectedAnalysisId(video?.analyses.find(a => a.analysis_id !== selectedAnalysisId)?.analysis_id ?? null);
      setAnalysis(null);
    } finally {
      setDeleting(false);
    }
  }, [videoId, selectedAnalysisId, video, loadVideo]);

  const handleReanalysisTriggered = useCallback((newAnalysisId: string) => {
    loadVideo();
    setSelectedAnalysisId(newAnalysisId);
  }, [loadVideo]);

  const handleConversationsChanged = useCallback(async () => {
    const v = await getVideo(videoId);
    setConversations(v.conversations ?? []);
  }, [videoId]);

  if (!video) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        Loading…
      </div>
    );
  }

  const inProgress = analysis && analysis.stage !== "complete" && analysis.stage !== "failed";

  return (
    <div className="flex flex-col gap-4 max-w-7xl mx-auto">
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={onBack}
          className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors py-1"
        >
          ← Library
        </button>
        <h2 className="text-base font-semibold truncate flex-1 min-w-0 text-gray-900 dark:text-gray-100">
          {video.filename}
        </h2>

        {video.analyses.length > 1 && (
          <select
            value={selectedAnalysisId ?? ""}
            onChange={e => setSelectedAnalysisId(e.target.value)}
            className="text-xs bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-2 py-1.5 text-gray-700 dark:text-gray-300 focus:outline-none"
          >
            {video.analyses.map((a, i) => (
              <option key={a.analysis_id} value={a.analysis_id}>
                Analysis {video.analyses.length - i} — {a.stage}
              </option>
            ))}
          </select>
        )}

        <button
          onClick={handleRerun}
          disabled={rerunning}
          className="px-3 py-1.5 text-xs bg-pitch-700 hover:bg-pitch-500 disabled:opacity-50 text-white rounded-lg transition-colors touch-manipulation"
        >
          {rerunning ? "Starting…" : "Re-run Analysis"}
        </button>

        {selectedAnalysisId && (
          <button
            onClick={handleDeleteAnalysis}
            disabled={deleting}
            className="px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-800 hover:bg-red-100 dark:hover:bg-red-900 text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-300 disabled:opacity-50 rounded-lg transition-colors touch-manipulation"
          >
            {deleting ? "…" : "Delete Analysis"}
          </button>
        )}
      </div>

      {/* Main content */}
      <div className="flex flex-col lg:flex-row gap-4">
        {/* Left: video + analysis panel */}
        <div className="flex-1 min-w-0 space-y-4">
          {analysis ? (
            <AnalysisPanel
              videoId={videoId}
              analysis={analysis}
              inProgress={!!inProgress}
            />
          ) : (
            <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
              {video.analyses.length === 0
                ? "No analyses yet — click Re-run Analysis to start."
                : "Select an analysis above."}
            </div>
          )}
        </div>

        {/* Right: chat */}
        <div className="lg:w-96 flex flex-col min-h-0">
          <div className="bg-gray-100 dark:bg-gray-900 rounded-xl p-4 flex flex-col" style={{ height: "min(70vh, 600px)" }}>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">
              Chat
            </h3>
            <div className="flex-1 min-h-0">
              <ChatPanel
                videoId={videoId}
                analysisId={selectedAnalysisId ?? undefined}
                conversations={conversations}
                onReanalysisTriggered={handleReanalysisTriggered}
                onConversationsChanged={handleConversationsChanged}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Analysis panel ────────────────────────────────────────────────────────────

type Tab = "metrics" | "ai";

function AnalysisPanel({
  videoId, analysis, inProgress,
}: {
  videoId: string;
  analysis: AnalysisSummary;
  inProgress: boolean;
}) {
  const [tab, setTab] = useState<Tab>("metrics");
  const [impactFrame, setImpactFrame] = useState<number | null>(analysis.analysis?.impact_frame ?? null);
  const [markingImpact, setMarkingImpact] = useState(false);
  const [impactError, setImpactError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleMarkImpact = useCallback(async () => {
    if (!videoRef.current) return;
    const frame = Math.round(videoRef.current.currentTime * 30);
    setMarkingImpact(true);
    setImpactError(null);
    try {
      await markAnalysisImpact(videoId, analysis.analysis_id, frame);
      setImpactFrame(frame);
    } catch (e) {
      setImpactError(e instanceof Error ? e.message : "Failed");
    } finally {
      setMarkingImpact(false);
    }
  }, [videoId, analysis.analysis_id]);

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      {/* Video */}
      <div className="flex-1 min-w-0 space-y-2">
        {inProgress ? (
          <div className="w-full rounded-xl bg-gray-100 dark:bg-gray-900 flex flex-col items-center justify-center gap-3 py-16">
            <span className="animate-spin text-3xl">⟳</span>
            <p className="text-gray-500 text-sm capitalize">{analysis.stage}…</p>
            {analysis.progress > 0 && (
              <div className="w-48 bg-gray-200 dark:bg-gray-800 rounded-full h-1.5">
                <div
                  className="bg-pitch-500 h-1.5 rounded-full transition-all"
                  style={{ width: `${Math.round(analysis.progress * 100)}%` }}
                />
              </div>
            )}
          </div>
        ) : analysis.has_annotated_video ? (
          <video
            ref={videoRef}
            src={analysisVideoUrl(videoId, analysis.analysis_id)}
            controls
            playsInline
            className="w-full rounded-xl bg-black"
          />
        ) : analysis.stage === "failed" ? (
          <div className="w-full rounded-xl bg-red-50 dark:bg-gray-900 flex items-center justify-center py-16">
            <p className="text-red-500 dark:text-red-400 text-sm">{analysis.error ?? "Analysis failed"}</p>
          </div>
        ) : null}

        {analysis.stage === "complete" && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleMarkImpact}
              disabled={markingImpact}
              className="px-4 py-2 bg-pitch-700 hover:bg-pitch-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors touch-manipulation"
            >
              {markingImpact ? "Marking…" : "Mark Impact Frame"}
            </button>
            {impactFrame !== null && (
              <span className="text-sm text-gray-500">Frame {impactFrame} marked</span>
            )}
            {impactError && <span className="text-sm text-red-500 dark:text-red-400">{impactError}</span>}
          </div>
        )}
      </div>

      {/* Tabs */}
      {analysis.stage === "complete" && (
        <div className="lg:w-80 flex flex-col min-w-0">
          <div className="flex border-b border-gray-200 dark:border-gray-700">
            {(["metrics", "ai"] as Tab[]).map(key => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex-1 px-4 py-3 text-sm font-medium transition-colors touch-manipulation
                  ${tab === key
                    ? "text-gray-900 dark:text-white border-b-2 border-pitch-500 -mb-px"
                    : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}
              >
                {key === "metrics" ? "Metrics" : "AI Insights"}
              </button>
            ))}
          </div>
          <div className="bg-gray-100 dark:bg-gray-900 rounded-b-xl rounded-tr-xl p-4 overflow-y-auto" style={{ maxHeight: "60vh" }}>
            {tab === "metrics" && analysis.analysis && (
              <MetricsPanel analysis={analysis.analysis} />
            )}
            {tab === "ai" && (
              <AIPanel
                insights={analysis.insights}
                hasInsights={analysis.has_llm_insights}
                llmEnabled={analysis.llm_enabled}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Metrics ───────────────────────────────────────────────────────────────────

function MetricsPanel({ analysis }: { analysis: StanceMetrics }) {
  const rows = [
    { label: "Stance Width",              value: analysis.stance_width_normalized,  unit: "× shoulder" },
    { label: "Head Stillness (variance)", value: analysis.head_stillness_variance,  unit: "px²" },
    { label: "Backlift Peak Height",      value: analysis.backlift_peak_height,     unit: "px above shoulder" },
    { label: "Front-Foot Stride",         value: analysis.front_foot_stride_length, unit: "× shoulder" },
    { label: "Impact Frame",              value: analysis.impact_frame,             unit: "" },
    { label: "Head over Front Foot",      value: analysis.head_over_front_foot,     unit: "px" },
  ];

  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-gray-800 dark:text-gray-200 text-sm">Biomechanical Metrics</h3>
      {rows.map(({ label, value, unit }) => (
        <div key={label} className="border-b border-gray-200 dark:border-gray-800 pb-2 last:border-0">
          <div className="flex justify-between items-baseline gap-2">
            <span className="text-sm text-gray-500 shrink-0">{label}</span>
            <span className="font-mono text-sm text-right text-gray-800 dark:text-gray-200">
              {value !== null && value !== undefined
                ? `${typeof value === "number" ? value.toFixed(2) : value}${unit ? " " + unit : ""}`
                : <span className="text-gray-400 dark:text-gray-600">—</span>}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── AI Insights ───────────────────────────────────────────────────────────────

function AIPanel({
  insights, hasInsights, llmEnabled,
}: {
  insights?: Insights;
  hasInsights: boolean;
  llmEnabled?: boolean;
}) {
  if (!hasInsights && !llmEnabled) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3 text-center px-2">
        <span className="text-3xl">🔑</span>
        <p className="text-gray-500 text-sm">No API key when video was processed.</p>
        <p className="text-gray-400 dark:text-gray-600 text-xs">Click Re-run Analysis to get insights.</p>
      </div>
    );
  }
  if (!hasInsights) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-2 text-center">
        <span className="animate-spin text-2xl">⟳</span>
        <p className="text-gray-500 text-sm">AI insights generating…</p>
      </div>
    );
  }
  if (!insights) return null;

  const { coaching_feedback, shot_classification, vision_review, impact_vision } = insights;
  const allFrames = [...(vision_review ?? []), ...(impact_vision ?? [])];

  return (
    <div className="space-y-5">
      {shot_classification && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">Shot Type</h4>
          <div className="p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-transparent">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-base font-semibold capitalize text-gray-900 dark:text-gray-100">
                {shot_classification.shot_type}
              </span>
              <span className={`text-xs ${
                shot_classification.confidence === "high" ? "text-pitch-500"
                : shot_classification.confidence === "medium" ? "text-yellow-500 dark:text-yellow-400"
                : "text-red-500 dark:text-red-400"
              }`}>
                {shot_classification.confidence} confidence
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-1">{shot_classification.reasoning}</p>
          </div>
        </section>
      )}

      {coaching_feedback && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">Coaching Feedback</h4>
          <div className="space-y-3">
            <FeedbackList label="Strengths" color="text-pitch-600 dark:text-pitch-500" items={coaching_feedback.strengths} />
            <FeedbackList label="Issues"    color="text-red-500 dark:text-red-400"     items={coaching_feedback.issues} />
            <FeedbackList label="Drills"    color="text-yellow-600 dark:text-yellow-400" items={coaching_feedback.drills} />
          </div>
        </section>
      )}

      {allFrames.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">Frame Observations</h4>
          <div className="space-y-2">
            {allFrames.map((frame, i) => (
              <div key={i} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-transparent rounded-lg p-3">
                <p className="text-xs text-gray-400 dark:text-gray-500 font-mono mb-1.5">{frame.frame_label}</p>
                <ul className="space-y-1">
                  {frame.observations.map((obs, j) => (
                    <li key={j} className="text-sm text-gray-700 dark:text-gray-300 flex gap-2">
                      <span className="text-gray-400 dark:text-gray-600 flex-shrink-0">•</span>
                      {obs}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function FeedbackList({ label, color, items }: { label: string; color: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className={`text-xs font-medium ${color} mb-1.5`}>{label}</p>
      <ul className="space-y-1">
        {items.map((text, i) => (
          <li key={i} className="text-sm text-gray-700 dark:text-gray-300 flex gap-2">
            <span className="text-gray-400 dark:text-gray-600 flex-shrink-0">•</span>
            {text}
          </li>
        ))}
      </ul>
    </div>
  );
}
