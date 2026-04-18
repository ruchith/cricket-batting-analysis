import { useState, useRef, useCallback } from "react";
import { uploadVideo } from "../api";

interface Props {
  onJobCreated: (jobId: string) => void;
}

export function UploadView({ onJobCreated }: Props) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.match(/\.(mov|mp4)$/i)) {
        setError("Only .mov and .mp4 files are accepted.");
        return;
      }
      setError(null);
      setUploading(true);
      setProgress(0);
      try {
        const jobId = await uploadVideo(file, setProgress);
        onJobCreated(jobId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
        setUploading(false);
      }
    },
    [onJobCreated]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <div className="max-w-xl mx-auto mt-16">
      <div
        className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-colors
          ${dragging ? "border-pitch-500 bg-pitch-900/20" : "border-gray-700 hover:border-gray-500"}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !uploading && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".mov,.mp4,video/quicktime,video/mp4"
          onChange={onInputChange}
          disabled={uploading}
        />

        {uploading ? (
          <div className="space-y-4">
            <div className="text-4xl">📤</div>
            <p className="text-gray-300">Uploading…</p>
            <div className="w-full bg-gray-800 rounded-full h-2">
              <div
                className="bg-pitch-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <p className="text-sm text-gray-400">{Math.round(progress * 100)}%</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-5xl">🏏</div>
            <p className="text-lg font-medium">Drop your cricket video here</p>
            <p className="text-sm text-gray-400">
              or click to browse — .mov and .mp4 accepted
            </p>
            <p className="text-xs text-gray-600">
              Shoot from the bowler's end facing the batter for best results
            </p>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 p-3 bg-red-900/40 border border-red-700 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}
    </div>
  );
}
