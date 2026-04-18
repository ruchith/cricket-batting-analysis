import { useState, useCallback, useEffect } from "react";
import { UploadView } from "./components/UploadView";
import { LibraryView } from "./components/LibraryView";
import { VideoDetailView } from "./components/VideoDetailView";

type AppView = "upload" | "library" | "video";

function useDarkMode() {
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem("theme");
    if (stored) return stored === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  return [dark, setDark] as const;
}

export default function App() {
  const [view, setView] = useState<AppView>("library");
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string | null>(null);
  const [libraryKey, setLibraryKey] = useState(0);
  const [dark, setDark] = useDarkMode();

  const handleJobCreated = useCallback((videoId: string, analysisId: string) => {
    setSelectedVideoId(videoId);
    setSelectedAnalysisId(analysisId);
    setLibraryKey(k => k + 1);
    setView("video");
  }, []);

  const handleSelectVideo = useCallback((videoId: string) => {
    setSelectedVideoId(videoId);
    setSelectedAnalysisId(null);
    setView("video");
  }, []);

  const handleBackToLibrary = useCallback(() => {
    setLibraryKey(k => k + 1);
    setView("library");
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-gray-200 dark:border-gray-800 px-4 sm:px-6 py-3 flex items-center gap-3 bg-white dark:bg-gray-950">
        <span className="text-xl sm:text-2xl">🏏</span>
        <h1 className="text-base sm:text-xl font-semibold tracking-tight">Cricket Batting Analysis</h1>

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setView("library")}
            className={`text-sm px-3 py-2 rounded-lg transition-colors touch-manipulation
              ${view === "library"
                ? "text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-800"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"}`}
          >
            Library
          </button>
          <button
            onClick={() => setView("upload")}
            className={`text-sm px-3 py-2 rounded-lg transition-colors touch-manipulation
              ${view === "upload"
                ? "text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-800"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"}`}
          >
            + Upload
          </button>

          <button
            onClick={() => setDark(d => !d)}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors touch-manipulation"
            title={dark ? "Switch to light mode" : "Switch to dark mode"}
          >
            {dark ? "☀️" : "🌙"}
          </button>
        </div>
      </header>

      <main className="flex-1 p-4 sm:p-6">
        {view === "upload" && (
          <UploadView onJobCreated={handleJobCreated} />
        )}
        {view === "library" && (
          <div className="max-w-2xl mx-auto">
            <LibraryView onSelectVideo={handleSelectVideo} refreshKey={libraryKey} />
          </div>
        )}
        {view === "video" && selectedVideoId && (
          <VideoDetailView
            videoId={selectedVideoId}
            initialAnalysisId={selectedAnalysisId ?? undefined}
            onBack={handleBackToLibrary}
          />
        )}
      </main>
    </div>
  );
}
