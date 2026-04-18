import { useState, useEffect, useCallback } from "react";
import { listVideos, deleteVideo } from "../api";
import type { VideoMeta } from "../types";

interface Props {
  onSelectVideo: (videoId: string) => void;
  refreshKey: number;
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() / 1000) - ts);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function LibraryView({ onSelectVideo, refreshKey }: Props) {
  const [videos, setVideos] = useState<VideoMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setVideos(await listVideos());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const handleDelete = async (videoId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this video and all its analyses and conversations?")) return;
    setDeleting(videoId);
    await deleteVideo(videoId);
    setVideos(v => v.filter(x => x.video_id !== videoId));
    setDeleting(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-gray-500">
        Loading library…
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-2 text-center text-gray-500">
        <span className="text-3xl">📂</span>
        <p className="text-sm">No videos yet — upload one to get started.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {videos.map((v) => {
        const latest = v.analyses[0];
        const analysisCount = v.analyses.length;
        const convCount = v.conversation_count ?? v.conversations?.length ?? 0;

        return (
          <div
            key={v.video_id}
            onClick={() => onSelectVideo(v.video_id)}
            className="flex items-center gap-3 p-3 sm:p-4 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 active:bg-gray-100 dark:active:bg-gray-800 border border-gray-200 dark:border-transparent rounded-xl cursor-pointer transition-colors touch-manipulation"
          >
            <div className="text-2xl flex-shrink-0">🎥</div>

            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate text-gray-900 dark:text-gray-100">{v.filename}</p>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                <span className="text-xs text-gray-500">{timeAgo(v.created_at)}</span>
                <span className="text-xs text-gray-400 dark:text-gray-600">
                  {analysisCount} {analysisCount === 1 ? "analysis" : "analyses"}
                </span>
                {convCount > 0 && (
                  <span className="text-xs text-gray-400 dark:text-gray-600">
                    {convCount} {convCount === 1 ? "conversation" : "conversations"}
                  </span>
                )}
              </div>
            </div>

            {latest && (
              <div className="flex-shrink-0">
                {latest.stage === "complete" ? (
                  <span className="text-xs px-2 py-0.5 bg-green-100 dark:bg-pitch-900 text-green-700 dark:text-pitch-500 rounded-full">
                    {latest.has_llm_insights ? "✓ AI" : "✓ Done"}
                  </span>
                ) : latest.stage === "failed" ? (
                  <span className="text-xs px-2 py-0.5 bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400 rounded-full">Failed</span>
                ) : (
                  <span className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 rounded-full animate-pulse">
                    {latest.stage}…
                  </span>
                )}
              </div>
            )}

            <button
              onClick={(e) => handleDelete(v.video_id, e)}
              disabled={deleting === v.video_id}
              className="flex-shrink-0 w-8 h-8 flex items-center justify-center text-gray-400 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 active:text-red-500 rounded transition-colors touch-manipulation"
              title="Delete video"
            >
              {deleting === v.video_id ? "…" : "🗑"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
