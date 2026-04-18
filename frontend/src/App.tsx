import { useState, useEffect, useCallback } from "react";
import { UploadView } from "./components/UploadView";
import { ProcessingView } from "./components/ProcessingView";
import { ResultsView } from "./components/ResultsView";
import { getJob } from "./api";
import type { JobResponse } from "./types";

type AppView = "upload" | "processing" | "results";

export default function App() {
  const [view, setView] = useState<AppView>("upload");
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobData, setJobData] = useState<JobResponse | null>(null);

  const handleJobCreated = useCallback((id: string) => {
    setJobId(id);
    setView("processing");
  }, []);

  const handleJobComplete = useCallback((data: JobResponse) => {
    setJobData(data);
    setView("results");
  }, []);

  const handleReset = useCallback(() => {
    setJobId(null);
    setJobData(null);
    setView("upload");
  }, []);

  // Refresh job data when back on results (e.g. after impact mark)
  const refreshJobData = useCallback(async () => {
    if (!jobId) return;
    try {
      const data = await getJob(jobId);
      setJobData(data);
    } catch (e) {
      console.error("Failed to refresh job:", e);
    }
  }, [jobId]);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center gap-3">
        <span className="text-2xl">🏏</span>
        <h1 className="text-xl font-semibold tracking-tight">Cricket Batting Analysis</h1>
        {view !== "upload" && (
          <button
            onClick={handleReset}
            className="ml-auto text-sm text-gray-400 hover:text-white transition-colors"
          >
            ← New Upload
          </button>
        )}
      </header>

      <main className="flex-1 p-6">
        {view === "upload" && (
          <UploadView onJobCreated={handleJobCreated} />
        )}
        {view === "processing" && jobId && (
          <ProcessingView jobId={jobId} onComplete={handleJobComplete} />
        )}
        {view === "results" && jobId && jobData && (
          <ResultsView
            jobId={jobId}
            jobData={jobData}
            onRefresh={refreshJobData}
          />
        )}
      </main>
    </div>
  );
}
