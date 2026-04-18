import { useState, useRef, useCallback } from "react";
import { videoUrl, markImpact, sendFeedback } from "../api";
import type { JobResponse, CoachingFeedback, FrameObservation } from "../types";

interface Props {
  jobId: string;
  jobData: JobResponse;
  onRefresh: () => void;
}

type Tab = "metrics" | "coaching" | "shot";

export function ResultsView({ jobId, jobData, onRefresh }: Props) {
  const { analysis, insights, has_llm_insights } = jobData;
  const [tab, setTab] = useState<Tab>("metrics");
  const [impactFrame, setImpactFrame] = useState<number | null>(analysis?.impact_frame ?? null);
  const [markingImpact, setMarkingImpact] = useState(false);
  const [impactError, setImpactError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleMarkImpact = useCallback(async () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const fps = 30; // approximation; full impl would read from metadata
    const frame = Math.round(video.currentTime * fps);
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

  const availableTabs: Tab[] = ["metrics"];
  if (has_llm_insights && insights?.coaching_feedback) availableTabs.push("coaching");
  if (has_llm_insights && (insights?.shot_classification || insights?.vision_review)) availableTabs.push("shot");

  return (
    <div className="flex flex-col lg:flex-row gap-6 max-w-7xl mx-auto">
      {/* Left: video + frame scrubber */}
      <div className="flex-1 space-y-3">
        <video
          ref={videoRef}
          src={videoUrl(jobId)}
          controls
          className="w-full rounded-xl bg-black"
        />

        <div className="flex items-center gap-3">
          <button
            onClick={handleMarkImpact}
            disabled={markingImpact}
            className="px-4 py-2 bg-pitch-700 hover:bg-pitch-500 disabled:opacity-50 text-sm rounded-lg transition-colors"
          >
            {markingImpact ? "Marking…" : "Mark Impact Frame"}
          </button>
          {impactFrame !== null && (
            <span className="text-sm text-gray-400">Impact marked at frame {impactFrame}</span>
          )}
          {impactError && (
            <span className="text-sm text-red-400">{impactError}</span>
          )}
        </div>
      </div>

      {/* Right: tabbed analysis panel */}
      <div className="lg:w-96 space-y-4">
        {/* Tab bar */}
        <div className="flex gap-1 border-b border-gray-800 pb-0">
          {availableTabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm rounded-t-lg transition-colors capitalize
                ${tab === t
                  ? "bg-gray-800 text-white border border-b-gray-800 border-gray-700"
                  : "text-gray-500 hover:text-gray-300"}`}
            >
              {t === "coaching" ? "Coaching" : t === "shot" ? "Shot" : "Metrics"}
            </button>
          ))}
        </div>

        <div className="bg-gray-900 rounded-xl p-4 min-h-64">
          {tab === "metrics" && analysis && (
            <MetricsTab analysis={analysis} />
          )}
          {tab === "coaching" && insights?.coaching_feedback && (
            <CoachingTab
              coaching={insights.coaching_feedback}
              jobId={jobId}
            />
          )}
          {tab === "shot" && (
            <ShotTab
              shotClass={insights?.shot_classification}
              visionReview={insights?.vision_review}
              impactVision={insights?.impact_vision}
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
    {
      label: "Stance Width",
      value: analysis.stance_width_normalized,
      unit: "× shoulder width",
      hint: "1.0–1.5 is typical for batters",
    },
    {
      label: "Head Stillness (variance)",
      value: analysis.head_stillness_variance,
      unit: "px²",
      hint: "Lower is better",
    },
    {
      label: "Backlift Peak Height",
      value: analysis.backlift_peak_height,
      unit: "px above shoulder",
      hint: "Higher = more backlift",
    },
    {
      label: "Front-Foot Stride",
      value: analysis.front_foot_stride_length,
      unit: "× shoulder width",
      hint: "Forward drive typically 0.8–1.4×",
    },
    {
      label: "Impact Frame",
      value: analysis.impact_frame,
      unit: "",
      hint: "Mark by pausing video and clicking the button",
    },
    {
      label: "Head over Front Foot",
      value: analysis.head_over_front_foot,
      unit: "px",
      hint: "Positive = head ahead of foot — good for drives",
    },
  ];

  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-gray-200">Biomechanical Metrics</h3>
      {rows.map(({ label, value, unit, hint }) => (
        <div key={label} className="border-b border-gray-800 pb-2 last:border-0">
          <div className="flex justify-between items-baseline">
            <span className="text-sm text-gray-400">{label}</span>
            <span className="font-mono text-sm">
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

// ── Coaching tab ──────────────────────────────────────────────────────────────

function CoachingTab({
  coaching,
  jobId,
}: {
  coaching: CoachingFeedback;
  jobId: string;
}) {
  const [voted, setVoted] = useState<Record<string, boolean | null>>({});

  const vote = (id: string, useful: boolean) => {
    setVoted((v) => ({ ...v, [id]: useful }));
    sendFeedback(jobId, id, useful).catch(console.error);
  };

  const FeedbackItem = ({ id, text }: { id: string; text: string }) => (
    <li className="flex items-start gap-2">
      <span className="flex-1 text-sm text-gray-300">{text}</span>
      {voted[id] === undefined ? (
        <span className="flex gap-1 flex-shrink-0">
          <button
            onClick={() => vote(id, true)}
            className="text-gray-500 hover:text-pitch-500 text-xs"
            title="Helpful"
          >👍</button>
          <button
            onClick={() => vote(id, false)}
            className="text-gray-500 hover:text-red-400 text-xs"
            title="Not helpful"
          >👎</button>
        </span>
      ) : (
        <span className="text-xs text-gray-600">{voted[id] ? "👍" : "👎"}</span>
      )}
    </li>
  );

  return (
    <div className="space-y-4">
      <section>
        <h4 className="text-sm font-semibold text-pitch-500 mb-2">Strengths</h4>
        <ul className="space-y-2">
          {coaching.strengths.map((s, i) => (
            <FeedbackItem key={`s-${i}`} id={`strength-${i}`} text={s} />
          ))}
        </ul>
      </section>
      <section>
        <h4 className="text-sm font-semibold text-red-400 mb-2">Issues</h4>
        <ul className="space-y-2">
          {coaching.issues.map((s, i) => (
            <FeedbackItem key={`i-${i}`} id={`issue-${i}`} text={s} />
          ))}
        </ul>
      </section>
      <section>
        <h4 className="text-sm font-semibold text-yellow-400 mb-2">Drills</h4>
        <ul className="space-y-2">
          {coaching.drills.map((s, i) => (
            <FeedbackItem key={`d-${i}`} id={`drill-${i}`} text={s} />
          ))}
        </ul>
      </section>
    </div>
  );
}

// ── Shot tab ──────────────────────────────────────────────────────────────────

function ShotTab({
  shotClass,
  visionReview,
  impactVision,
}: {
  shotClass?: { shot_type: string; confidence: string; reasoning: string };
  visionReview?: FrameObservation[];
  impactVision?: FrameObservation[];
}) {
  const confidenceColor =
    shotClass?.confidence === "high"
      ? "text-pitch-500"
      : shotClass?.confidence === "medium"
      ? "text-yellow-400"
      : "text-red-400";

  const allFrames = [...(visionReview ?? []), ...(impactVision ?? [])];

  return (
    <div className="space-y-4">
      {shotClass && (
        <div className="p-3 bg-gray-800 rounded-lg">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-semibold capitalize">{shotClass.shot_type}</span>
            <span className={`text-xs ${confidenceColor}`}>{shotClass.confidence} confidence</span>
          </div>
          <p className="text-sm text-gray-400 mt-1">{shotClass.reasoning}</p>
        </div>
      )}

      {allFrames.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-gray-300">Frame Observations</h4>
          {allFrames.map((frame, i) => (
            <div key={i} className="bg-gray-800 rounded-lg p-3">
              <p className="text-xs text-gray-500 font-mono mb-2">{frame.frame_label}</p>
              <ul className="space-y-1">
                {frame.observations.map((obs, j) => (
                  <li key={j} className="text-sm text-gray-300 flex gap-2">
                    <span className="text-gray-600 flex-shrink-0">•</span>
                    {obs}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {!shotClass && allFrames.length === 0 && (
        <p className="text-sm text-gray-500">Shot analysis not available.</p>
      )}
    </div>
  );
}
