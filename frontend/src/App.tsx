import { useState, useCallback, useEffect } from "react";
import { UploadView } from "./components/UploadView";
import { LibraryView } from "./components/LibraryView";
import { VideoDetailView } from "./components/VideoDetailView";

type AppView = "upload" | "library" | "video";

const UUID_RE = /^\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function parseUrl(): { view: AppView; videoId: string | null } {
  const match = window.location.pathname.match(UUID_RE);
  if (match) return { view: "video", videoId: match[1] };
  return { view: "library", videoId: null };
}

function useDarkMode() {
  const [dark, setDark] = useState(() => localStorage.getItem("theme") === "dark");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  return [dark, setDark] as const;
}

export default function App() {
  const initial = parseUrl();
  const [view, setView] = useState<AppView>(initial.view);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(initial.videoId);
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string | null>(null);
  const [libraryKey, setLibraryKey] = useState(0);
  const [dark, setDark] = useDarkMode();

  // Sync URL → state on browser back/forward
  useEffect(() => {
    const onPop = () => {
      const { view: v, videoId } = parseUrl();
      setView(v);
      setSelectedVideoId(videoId);
      setSelectedAnalysisId(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigateToVideo = useCallback((videoId: string, analysisId: string | null = null) => {
    history.pushState(null, "", `/${videoId}`);
    setSelectedVideoId(videoId);
    setSelectedAnalysisId(analysisId);
    setView("video");
  }, []);

  const navigateToLibrary = useCallback(() => {
    history.pushState(null, "", "/");
    setLibraryKey(k => k + 1);
    setView("library");
  }, []);

  const navigateToUpload = useCallback(() => {
    history.pushState(null, "", "/");
    setView("upload");
  }, []);

  const handleJobCreated = useCallback((videoId: string, analysisId: string) => {
    setLibraryKey(k => k + 1);
    navigateToVideo(videoId, analysisId);
  }, [navigateToVideo]);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-gray-200 dark:border-gray-800 px-4 sm:px-6 py-3 flex items-center gap-3 bg-white dark:bg-gray-950">
        <span className="text-xl sm:text-2xl">🏏</span>
        <h1 className="text-base sm:text-xl font-semibold tracking-tight">Cricket Batting Analysis</h1>

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={navigateToLibrary}
            className={`text-sm px-3 py-2 rounded-lg transition-colors touch-manipulation
              ${view === "library"
                ? "text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-800"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"}`}
          >
            Library
          </button>
          <button
            onClick={navigateToUpload}
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
            <LibraryView onSelectVideo={navigateToVideo} refreshKey={libraryKey} />
          </div>
        )}
        {view === "video" && selectedVideoId && (
          <VideoDetailView
            videoId={selectedVideoId}
            initialAnalysisId={selectedAnalysisId ?? undefined}
            onBack={navigateToLibrary}
          />
        )}
      </main>
    </div>
  );
}
