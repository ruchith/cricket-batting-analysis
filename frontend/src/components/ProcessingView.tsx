import { useEffect, useState, useRef } from "react";
import { getJob } from "../api";
import type { JobResponse, Stage } from "../types";

interface Props {
  jobId: string;
  onComplete: (data: JobResponse) => void;
}

const STAGES: { key: Stage; label: string; description: string }[] = [
  { key: "ingest",    label: "Ingest",          description: "Saving upload" },
  { key: "normalize", label: "Normalize",        description: "Transcoding & fixing rotation" },
  { key: "pose",      label: "Pose Estimation",  description: "Running MediaPipe on every frame" },
  { key: "metrics",   label: "Metrics",          description: "Computing biomechanical measurements" },
  { key: "render",    label: "Render",           description: "Burning skeleton overlay" },
  { key: "llm",       label: "AI Insights",      description: "Claude coaching analysis" },
  { key: "complete",  label: "Done",             description: "Ready to review" },
];

const STAGE_ORDER: Stage[] = ["queued","ingest","normalize","pose","metrics","render","llm","complete"];

function stageIndex(s: Stage) { return STAGE_ORDER.indexOf(s); }

export function ProcessingView({ jobId, onComplete }: Props) {
  const [job, setJob] = useState<JobResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const poll = async () => {
      try {
        const data = await getJob(jobId);
        setJob(data);
        if (data.stage === "complete") {
          if (intervalRef.current) clearInterval(intervalRef.current);
          onComplete(data);
        } else if (data.stage === "failed") {
          if (intervalRef.current) clearInterval(intervalRef.current);
          setError(data.error ?? "Pipeline failed");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Poll error");
      }
    };

    poll();
    intervalRef.current = setInterval(poll, 2000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [jobId, onComplete]);

  const currentIdx = job ? stageIndex(job.stage) : 0;

  return (
    <div className="max-w-lg mx-auto mt-8 sm:mt-12 space-y-5">
      <div>
        <h2 className="text-lg sm:text-xl font-semibold">Analysing your video…</h2>
        <p className="text-xs text-gray-500 mt-1 font-mono">{jobId}</p>
      </div>

      {job && (
        <div className="w-full bg-gray-800 rounded-full h-2">
          <div
            className="bg-pitch-500 h-2 rounded-full transition-all duration-500"
            style={{ width: `${Math.round(job.progress * 100)}%` }}
          />
        </div>
      )}

      <div className="space-y-1">
        {STAGES.map(({ key, label, description }) => {
          const idx = stageIndex(key);
          const done   = currentIdx > idx;
          const active = currentIdx === idx;

          return (
            <div
              key={key}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors
                ${active ? "bg-gray-800 border border-gray-700" : ""}
                ${done ? "opacity-60" : ""}
                ${!done && !active ? "opacity-25" : ""}`}
            >
              <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 text-sm">
                {done   ? <span className="text-pitch-500">✓</span>
                : active ? <span className="animate-spin inline-block">⟳</span>
                :          <span className="text-gray-600">○</span>}
              </div>
              <div className="min-w-0">
                <p className={`text-sm font-medium truncate ${active ? "text-white" : ""}`}>{label}</p>
                {active && <p className="text-xs text-gray-400">{description}</p>}
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <div className="p-4 bg-red-900/40 border border-red-700 rounded-lg">
          <p className="text-red-300 font-medium text-sm">Pipeline error</p>
          <p className="text-xs text-red-400 mt-1 break-all">{error}</p>
        </div>
      )}
    </div>
  );
}
