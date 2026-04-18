import { useState, useEffect, useRef, useCallback } from "react";
import {
  getVideo, getAnalysis, rerunAnalysis, deleteAnalysis,
  analysisVideoUrl, markAnalysisImpact, analysisReportUrl,
} from "../api";
import { ChatPanel } from "./ChatPanel";
import type {
  VideoMeta, AnalysisSummary, ConversationMeta,
  StanceMetrics, Insights, ShotSegmentation, FrameConfidence,
} from "../types";

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
  const [showRerunPanel, setShowRerunPanel] = useState(false);
  const [includeChatSummary, setIncludeChatSummary] = useState(true);
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

  const handleRerun = useCallback(async (withChatSummary: boolean) => {
    setRerunning(true);
    setShowRerunPanel(false);
    try {
      const { analysis_id } = await rerunAnalysis(videoId, {
        include_chat_summary: withChatSummary,
      });
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
          onClick={() => setShowRerunPanel(p => !p)}
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

      {/* Re-run confirmation panel */}
      {showRerunPanel && (
        <RerunPanel
          totalMessages={conversations.reduce((s, c) => s + c.message_count, 0)}
          includeChatSummary={includeChatSummary}
          onToggle={() => setIncludeChatSummary(v => !v)}
          onConfirm={() => handleRerun(includeChatSummary)}
          onCancel={() => setShowRerunPanel(false)}
        />
      )}

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

// ── Re-run confirmation panel ─────────────────────────────────────────────────

function RerunPanel({
  totalMessages, includeChatSummary, onToggle, onConfirm, onCancel,
}: {
  totalMessages: number;
  includeChatSummary: boolean;
  onToggle: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-xl px-4 py-3 flex flex-wrap items-center gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">Re-run Analysis</p>

        <label className="flex items-start gap-2.5 cursor-pointer group">
          <input
            type="checkbox"
            checked={includeChatSummary}
            onChange={onToggle}
            className="mt-0.5 accent-green-500 w-4 h-4 cursor-pointer"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">
            Include chat feedback
            {totalMessages > 0 ? (
              <span className="ml-1.5 text-xs text-gray-400 dark:text-gray-500">
                ({totalMessages} {totalMessages === 1 ? "message" : "messages"} across{" "}
                {/* conversation count shown via message total */"your conversations"})
              </span>
            ) : (
              <span className="ml-1.5 text-xs text-gray-400 dark:text-gray-500">(no messages yet)</span>
            )}
          </span>
        </label>

        {includeChatSummary && totalMessages > 0 && (
          <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400 ml-6.5">
            Claude will summarise your conversation and use it to inform coaching feedback and shot classification.
          </p>
        )}
        {includeChatSummary && totalMessages === 0 && (
          <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500 ml-6.5">
            No messages found — analysis will run without chat context.
          </p>
        )}
      </div>

      <div className="flex gap-2 flex-shrink-0">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg transition-colors touch-manipulation"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="px-3 py-1.5 text-xs bg-pitch-700 hover:bg-pitch-500 text-white rounded-lg transition-colors touch-manipulation"
        >
          Run Analysis
        </button>
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

  // Derive FPS from segmentation timestamps, fall back to 30
  const fps = (() => {
    const seg = analysis.segmentation;
    if (seg && seg.peak_frame > 0 && seg.peak_ts > 0) {
      return Math.round(seg.peak_frame / seg.peak_ts);
    }
    return 30;
  })();

  const seekToTs = useCallback((ts: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = ts;
    videoRef.current.pause();
  }, []);

  const stepFrame = useCallback((delta: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(
      0, videoRef.current.currentTime + delta / fps
    );
    videoRef.current.pause();
  }, [fps]);

  const handleMarkImpact = useCallback(async () => {
    if (!videoRef.current) return;
    const frame = Math.round(videoRef.current.currentTime * fps);
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
  }, [videoId, analysis.analysis_id, fps]);

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
            {/* Frame step buttons */}
            <button
              onClick={() => stepFrame(-1)}
              className="w-9 h-9 flex items-center justify-center bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 rounded-lg text-sm font-mono transition-colors touch-manipulation"
              title="Previous frame"
            >‹</button>
            <button
              onClick={() => stepFrame(1)}
              className="w-9 h-9 flex items-center justify-center bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 rounded-lg text-sm font-mono transition-colors touch-manipulation"
              title="Next frame"
            >›</button>

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
          <div className="flex items-center border-b border-gray-200 dark:border-gray-700">
            {(["metrics", "ai"] as Tab[]).map(key => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-4 py-3 text-sm font-medium transition-colors touch-manipulation
                  ${tab === key
                    ? "text-gray-900 dark:text-white border-b-2 border-pitch-500 -mb-px"
                    : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}
              >
                {key === "metrics" ? "Metrics" : "AI Insights"}
              </button>
            ))}
            {analysis.has_llm_insights && (
              <a
                href={analysisReportUrl(videoId, analysis.analysis_id)}
                download
                className="ml-auto mr-1 flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-pitch-500 text-white hover:bg-pitch-700 transition-colors touch-manipulation"
                title="Download HTML report"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Report
              </a>
            )}
          </div>
          <div className="bg-gray-100 dark:bg-gray-900 rounded-b-xl rounded-tr-xl p-4 overflow-y-auto" style={{ maxHeight: "60vh" }}>
            {tab === "metrics" && analysis.analysis && (
              <MetricsPanel
                analysis={analysis.analysis}
                segmentation={analysis.segmentation}
                confidence={analysis.confidence}
                onSeekToTs={seekToTs}
              />
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

function fmt(ts: number): string {
  const s = Math.floor(ts);
  const ms = Math.round((ts - s) * 10);
  return `${s}.${ms}s`;
}

function SeekBtn({ ts, onSeek }: { ts: number; onSeek: (ts: number) => void }) {
  return (
    <button
      onClick={() => onSeek(ts)}
      className="ml-1.5 w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-pitch-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors touch-manipulation flex-shrink-0"
      title={`Jump to ${ts.toFixed(2)}s`}
    >
      <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
        <path d="M3 2.5v11l10-5.5L3 2.5z" />
      </svg>
    </button>
  );
}

function MetricsPanel({
  analysis, segmentation, confidence, onSeekToTs,
}: {
  analysis: StanceMetrics;
  segmentation?: ShotSegmentation;
  confidence?: FrameConfidence[];
  onSeekToTs?: (ts: number) => void;
}) {
  const rows = [
    { label: "Stance Width",              value: analysis.stance_width_normalized,  unit: "× shoulder" },
    { label: "Head Stillness (variance)", value: analysis.head_stillness_variance,  unit: "px²" },
    { label: "Backlift Peak Height",      value: analysis.backlift_peak_height,     unit: "px above shoulder" },
    { label: "Front-Foot Stride",         value: analysis.front_foot_stride_length, unit: "× shoulder" },
    { label: "Impact Frame",              value: analysis.impact_frame,             unit: "" },
    { label: "Head over Front Foot",      value: analysis.head_over_front_foot,     unit: "px" },
  ];

  return (
    <div className="space-y-4">
      {/* Shot segmentation */}
      {segmentation && (
        <div>
          <h3 className="font-semibold text-gray-800 dark:text-gray-200 text-sm mb-2">Shot Window</h3>
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-transparent rounded-lg p-3 space-y-1.5 text-sm">
            {([
              { label: "Start",        frame: segmentation.shot_start_frame, ts: segmentation.shot_start_ts },
              { label: "Peak backlift", frame: segmentation.peak_frame,       ts: segmentation.peak_ts },
              { label: "End",          frame: segmentation.shot_end_frame,   ts: segmentation.shot_end_ts },
            ] as const).map(({ label, frame, ts }) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-gray-500 flex items-center gap-0.5">
                  {label}
                  {onSeekToTs && <SeekBtn ts={ts} onSeek={onSeekToTs} />}
                </span>
                <span className="font-mono text-gray-800 dark:text-gray-200">
                  f{frame} · {fmt(ts)}
                </span>
              </div>
            ))}
            <div className="flex justify-between">
              <span className="text-gray-500">Duration</span>
              <span className="font-mono text-gray-800 dark:text-gray-200">
                {(segmentation.shot_end_ts - segmentation.shot_start_ts).toFixed(2)}s
              </span>
            </div>
            {segmentation.method === "fallback_full_clip" && (
              <p className="text-xs text-yellow-600 dark:text-yellow-400 pt-1">
                ⚠ Boundary detection inconclusive — using full clip
              </p>
            )}
          </div>
        </div>
      )}

      {/* Confidence heatmap */}
      {confidence && confidence.length > 0 && (
        <div>
          <h3 className="font-semibold text-gray-800 dark:text-gray-200 text-sm mb-1">
            Pose Confidence
          </h3>
          <ConfidenceHeatmap data={confidence} segmentation={segmentation} />
        </div>
      )}

      {/* Metrics */}
      <div>
        <h3 className="font-semibold text-gray-800 dark:text-gray-200 text-sm mb-2">
          Biomechanical Metrics
          {segmentation && segmentation.method !== "fallback_full_clip" && (
            <span className="ml-2 text-xs font-normal text-pitch-500">
              (computed on shot window)
            </span>
          )}
        </h3>
        <div className="space-y-3">
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
      </div>
    </div>
  );
}

// ── Confidence heatmap ────────────────────────────────────────────────────────

function confidenceColor(c: number, detected: boolean): string {
  if (!detected || c === 0) return "#374151";           // gray-700
  if (c >= 0.7) return "#22c55e";                      // green
  if (c >= 0.4) return "#eab308";                      // yellow
  return "#ef4444";                                    // red
}

function ConfidenceHeatmap({
  data, segmentation,
}: {
  data: FrameConfidence[];
  segmentation?: ShotSegmentation;
}) {
  if (!data.length) return null;

  const totalTs = data[data.length - 1].ts || 1;
  const startFrac = segmentation ? segmentation.shot_start_ts / totalTs : null;
  const endFrac   = segmentation ? segmentation.shot_end_ts   / totalTs : null;

  // Mean confidence summary
  const detected = data.filter(d => d.detected);
  const avgConf  = detected.length
    ? detected.reduce((s, d) => s + d.confidence, 0) / detected.length
    : 0;
  const detectedPct = Math.round((detected.length / data.length) * 100);

  return (
    <div className="space-y-1">
      {/* Bar strip */}
      <div className="relative h-6 w-full rounded overflow-hidden flex">
        {data.map((d, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              backgroundColor: confidenceColor(d.confidence, d.detected),
              minWidth: 1,
            }}
            title={`f${d.frame} (${d.ts.toFixed(2)}s): ${d.detected ? `${(d.confidence * 100).toFixed(0)}%` : "no detection"}`}
          />
        ))}
        {/* Shot window overlay */}
        {startFrac !== null && endFrac !== null && (
          <>
            <div className="absolute top-0 bottom-0 border-l-2 border-white/70"
                 style={{ left: `${startFrac * 100}%` }} />
            <div className="absolute top-0 bottom-0 border-r-2 border-white/70"
                 style={{ left: `${endFrac * 100}%` }} />
          </>
        )}
      </div>

      {/* Legend + summary */}
      <div className="flex items-center gap-3 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-green-500" /> ≥70%
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-yellow-400" /> 40–70%
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-500" /> &lt;40%
        </span>
        <span className="ml-auto">
          avg {(avgConf * 100).toFixed(0)}% · {detectedPct}% detected
        </span>
      </div>
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
            <FeedbackList label="✅ Strengths"          color="text-pitch-600 dark:text-pitch-500"    items={coaching_feedback.strengths} />
            <FeedbackList label="⚠️ Areas to Improve"   color="text-red-500 dark:text-red-400"        items={coaching_feedback.issues} />
            <FeedbackList label="🎯 Focus Areas"        color="text-blue-600 dark:text-blue-400"      items={coaching_feedback.focus_areas ?? []} />
            <FeedbackList label="🔧 Corrective Actions" color="text-violet-600 dark:text-violet-400"  items={coaching_feedback.corrective_actions ?? []} />
            <FeedbackList label="🏋️ Drills"             color="text-yellow-600 dark:text-yellow-400"  items={coaching_feedback.drills} />
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
