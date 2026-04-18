import { useState, useRef, useCallback } from "react";
import { videoUrl, markImpact, sendFeedback } from "../api";
import type { JobResponse, CoachingFeedback, FrameObservation } from "../types";

interface Props {
  jobId: string;
  jobData: JobResponse;
  onRefresh: () => void;
}

type Tab = "metrics" | "ai";

export function ResultsView({ jobId, jobData, onRefresh }: Props) {
  const { analysis, insights, has_llm_insights, llm_enabled } = jobData;
  const [tab, setTab] = useState<Tab>("metrics");
  const [impactFrame, setImpactFrame] = useState<number | null>(analysis?.impact_frame ?? null);
  const [markingImpact, setMarkingImpact] = useState(false);
  const [impactError, setImpactError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleMarkImpact = useCallback(async () => {
    if (!videoRef.current) return;
    const fps = 30;
    const frame = Math.round(videoRef.current.currentTime * fps);
    setMarkingImpact(true);
    setImpactError(null);
    try {
      await markImpact(jobId, frame);
      setImpactFrame(frame);
      onRefresh();
    } catch (e) {
      setImpactError(e instanceof Error ? e.message : "Failed to mark impact");
    } finally {
      setMarkingImpact(false);
    }
  }, [jobId, onRefresh]);

  const tabs: { key: Tab; label: string }[] = [
    { key: "metrics", label: "Metrics" },
    { key: "ai",      label: "AI Insights" },
  ];

  return (
    <div className="flex flex-col lg:flex-row gap-4 sm:gap-6 max-w-7xl mx-auto">
      {/* Video + impact marker */}
      <div className="flex-1 space-y-3 min-w-0">
        <video
          ref={videoRef}
          src={videoUrl(jobId)}
          controls
          playsInline          /* prevents iOS Safari auto-fullscreen */
          className="w-full rounded-xl bg-black"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleMarkImpact}
            disabled={markingImpact}
            className="px-4 py-2.5 bg-pitch-700 hover:bg-pitch-500 active:bg-pitch-500 disabled:opacity-50 text-sm rounded-lg transition-colors touch-manipulation"
          >
            {markingImpact ? "Marking…" : "Mark Impact Frame"}
          </button>
          {impactFrame !== null && (
            <span className="text-sm text-gray-400">Frame {impactFrame} marked</span>
          )}
          {impactError && (
            <span className="text-sm text-red-400">{impactError}</span>
          )}
        </div>
      </div>

      {/* Tabbed analysis panel */}
      <div className="lg:w-96 flex flex-col min-w-0">
        {/* Tab bar */}
        <div className="flex border-b border-gray-700">
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-1 sm:flex-none px-5 py-3 text-sm font-medium transition-colors touch-manipulation
                ${tab === key
                  ? "text-white border-b-2 border-pitch-500 -mb-px"
                  : "text-gray-500 hover:text-gray-300 active:text-gray-300"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="bg-gray-900 rounded-b-xl rounded-tr-xl p-4 flex-1 overflow-y-auto" style={{ maxHeight: "70vh" }}>
          {tab === "metrics" && analysis && <MetricsTab analysis={analysis} />}
          {tab === "ai" && (
            <AIInsightsTab
              insights={insights}
              hasInsights={has_llm_insights}
              llmEnabled={llm_enabled}
              jobId={jobId}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Metrics tab ───────────────────────────────────────────────────────────────

function MetricsTab({ analysis }: { analysis: NonNullable<JobResponse["analysis"]> }) {
  const rows = [
    { label: "Stance Width",              value: analysis.stance_width_normalized,  unit: "× shoulder width", hint: "1.0–1.5 is typical" },
    { label: "Head Stillness (variance)", value: analysis.head_stillness_variance,  unit: "px²",              hint: "Lower is better" },
    { label: "Backlift Peak Height",      value: analysis.backlift_peak_height,     unit: "px above shoulder", hint: "Higher = more backlift" },
    { label: "Front-Foot Stride",         value: analysis.front_foot_stride_length, unit: "× shoulder width", hint: "Forward drive ~0.8–1.4×" },
    { label: "Impact Frame",              value: analysis.impact_frame,             unit: "",                  hint: "Pause video and tap Mark Impact Frame" },
    { label: "Head over Front Foot",      value: analysis.head_over_front_foot,     unit: "px",               hint: "Positive = head ahead of foot" },
  ];

  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-gray-200">Biomechanical Metrics</h3>
      {rows.map(({ label, value, unit, hint }) => (
        <div key={label} className="border-b border-gray-800 pb-2 last:border-0">
          <div className="flex justify-between items-baseline gap-2">
            <span className="text-sm text-gray-400 shrink-0">{label}</span>
            <span className="font-mono text-sm text-right">
              {value !== null && value !== undefined
                ? `${typeof value === "number" ? value.toFixed(2) : value}${unit ? " " + unit : ""}`
                : <span className="text-gray-600">—</span>}
            </span>
          </div>
          <p className="text-xs text-gray-600 mt-0.5">{hint}</p>
        </div>
      ))}
    </div>
  );
}

// ── AI Insights tab ───────────────────────────────────────────────────────────

function AIInsightsTab({
  insights, hasInsights, llmEnabled, jobId,
}: {
  insights: JobResponse["insights"];
  hasInsights: boolean;
  llmEnabled: boolean;
  jobId: string;
}) {
  if (!hasInsights && !llmEnabled) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3 text-center px-2">
        <span className="text-3xl">🔑</span>
        <p className="text-gray-400 text-sm">
          No <code className="text-gray-300">ANTHROPIC_API_KEY</code> was set when this video was processed.
        </p>
        <p className="text-gray-600 text-xs">Re-upload the video to get coaching feedback.</p>
      </div>
    );
  }

  if (!hasInsights && llmEnabled) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3 text-center px-2">
        <span className="text-3xl">🔑</span>
        <p className="text-gray-400 text-sm">This video was processed before the API key was configured.</p>
        <p className="text-gray-600 text-xs">Re-upload it to generate AI coaching insights.</p>
      </div>
    );
  }

  if (!insights || Object.keys(insights).length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-2 text-center">
        <span className="animate-spin text-2xl">⟳</span>
        <p className="text-gray-400 text-sm">AI insights are being generated…</p>
      </div>
    );
  }

  const { coaching_feedback, shot_classification, vision_review, impact_vision } = insights;
  const allFrames = [...(vision_review ?? []), ...(impact_vision ?? [])];

  return (
    <div className="space-y-5">
      {shot_classification && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Shot Type</h4>
          <div className="p-3 bg-gray-800 rounded-lg">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-base font-semibold capitalize">{shot_classification.shot_type}</span>
              <span className={`text-xs ${
                shot_classification.confidence === "high"   ? "text-pitch-500"
                : shot_classification.confidence === "medium" ? "text-yellow-400"
                : "text-red-400"
              }`}>
                {shot_classification.confidence} confidence
              </span>
            </div>
            <p className="text-sm text-gray-400 mt-1">{shot_classification.reasoning}</p>
          </div>
        </section>
      )}

      {coaching_feedback && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Coaching Feedback</h4>
          <div className="space-y-3">
            <FeedbackSection label="Strengths" color="text-pitch-500"  items={coaching_feedback.strengths} prefix="strength" jobId={jobId} />
            <FeedbackSection label="Issues"    color="text-red-400"    items={coaching_feedback.issues}    prefix="issue"    jobId={jobId} />
            <FeedbackSection label="Drills"    color="text-yellow-400" items={coaching_feedback.drills}    prefix="drill"    jobId={jobId} />
          </div>
        </section>
      )}

      {allFrames.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Frame Observations</h4>
          <div className="space-y-2">
            {allFrames.map((frame, i) => (
              <div key={i} className="bg-gray-800 rounded-lg p-3">
                <p className="text-xs text-gray-500 font-mono mb-1.5">{frame.frame_label}</p>
                <ul className="space-y-1">
                  {frame.observations.map((obs, j) => (
                    <li key={j} className="text-sm text-gray-300 flex gap-2">
                      <span className="text-gray-600 flex-shrink-0 mt-0.5">•</span>
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

function FeedbackSection({
  label, color, items, prefix, jobId,
}: {
  label: string; color: string; items: string[]; prefix: string; jobId: string;
}) {
  const [voted, setVoted] = useState<Record<string, boolean>>({});

  const vote = (id: string, useful: boolean) => {
    setVoted((v) => ({ ...v, [id]: useful }));
    sendFeedback(jobId, id, useful).catch(console.error);
  };

  if (items.length === 0) return null;

  return (
    <div>
      <p className={`text-xs font-medium ${color} mb-1.5`}>{label}</p>
      <ul className="space-y-2">
        {items.map((text, i) => {
          const id = `${prefix}-${i}`;
          return (
            <li key={id} className="flex items-start gap-2">
              <span className="flex-1 text-sm text-gray-300">{text}</span>
              {voted[id] === undefined ? (
                <span className="flex gap-1 flex-shrink-0">
                  {/* min 44px touch targets per Apple HIG */}
                  <button
                    onClick={() => vote(id, true)}
                    className="w-8 h-8 flex items-center justify-center rounded text-gray-500 hover:text-pitch-500 active:text-pitch-500 touch-manipulation"
                    title="Helpful"
                  >👍</button>
                  <button
                    onClick={() => vote(id, false)}
                    className="w-8 h-8 flex items-center justify-center rounded text-gray-500 hover:text-red-400 active:text-red-400 touch-manipulation"
                    title="Not helpful"
                  >👎</button>
                </span>
              ) : (
                <span className="w-8 h-8 flex items-center justify-center text-gray-600 flex-shrink-0">
                  {voted[id] ? "👍" : "👎"}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
