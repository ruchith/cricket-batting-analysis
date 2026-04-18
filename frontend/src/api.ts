import type {
  AnalysisSummary, Conversation, ConversationMeta, JobResponse,
  SendMessageResponse, VideoMeta,
} from "./types";

const BASE = "/api";

// ── Legacy job API (still used for old upload flow) ───────────────────────────

export async function uploadVideo(
  file: File,
  onProgress: (pct: number) => void
): Promise<{ video_id: string; analysis_id: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file);

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(new Error(`Upload failed: ${xhr.status} ${xhr.responseText}`));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
    xhr.open("POST", `${BASE}/videos`);
    xhr.send(form);
  });
}

export async function getJob(jobId: string): Promise<JobResponse> {
  const r = await fetch(`${BASE}/jobs/${jobId}`);
  if (!r.ok) throw new Error(`API error ${r.status}`);
  return r.json();
}

export function videoUrl(jobId: string): string {
  return `${BASE}/jobs/${jobId}/video`;
}

export async function markImpact(jobId: string, frameIndex: number) {
  const r = await fetch(`${BASE}/jobs/${jobId}/impact`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ frame_index: frameIndex }),
  });
  if (!r.ok) throw new Error(`Impact API error ${r.status}`);
  return r.json();
}

export async function sendFeedback(jobId: string, insightId: string, useful: boolean) {
  await fetch(`${BASE}/jobs/${jobId}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ insight_id: insightId, useful }),
  });
}

// ── Library API ───────────────────────────────────────────────────────────────

export async function listVideos(): Promise<VideoMeta[]> {
  const r = await fetch(`${BASE}/videos`);
  if (!r.ok) throw new Error(`API error ${r.status}`);
  const d = await r.json();
  return d.videos;
}

export async function getVideo(videoId: string): Promise<VideoMeta> {
  const r = await fetch(`${BASE}/videos/${videoId}`);
  if (!r.ok) throw new Error(`API error ${r.status}`);
  return r.json();
}

export async function deleteVideo(videoId: string): Promise<void> {
  await fetch(`${BASE}/videos/${videoId}`, { method: "DELETE" });
}

export async function getAnalysis(videoId: string, analysisId: string): Promise<AnalysisSummary> {
  const r = await fetch(`${BASE}/videos/${videoId}/analyses/${analysisId}`);
  if (!r.ok) throw new Error(`API error ${r.status}`);
  return r.json();
}

export async function rerunAnalysis(
  videoId: string,
  options?: { corrections?: Record<string, string>; include_chat_summary?: boolean }
): Promise<{ analysis_id: string }> {
  const r = await fetch(`${BASE}/videos/${videoId}/analyses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      corrections: options?.corrections ?? {},
      include_chat_summary: options?.include_chat_summary ?? true,
    }),
  });
  if (!r.ok) throw new Error(`API error ${r.status}`);
  return r.json();
}

export async function deleteAnalysis(videoId: string, analysisId: string): Promise<void> {
  await fetch(`${BASE}/videos/${videoId}/analyses/${analysisId}`, { method: "DELETE" });
}

export function analysisVideoUrl(videoId: string, analysisId: string): string {
  return `${BASE}/videos/${videoId}/analyses/${analysisId}/video`;
}

export async function markAnalysisImpact(
  videoId: string, analysisId: string, frameIndex: number
) {
  const r = await fetch(`${BASE}/videos/${videoId}/analyses/${analysisId}/impact`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ frame_index: frameIndex }),
  });
  if (!r.ok) throw new Error(`API error ${r.status}`);
  return r.json();
}

// ── Conversation API ──────────────────────────────────────────────────────────

export async function createConversation(
  videoId: string, title?: string
): Promise<{ conv_id: string }> {
  const r = await fetch(`${BASE}/videos/${videoId}/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: title ?? "" }),
  });
  if (!r.ok) throw new Error(`API error ${r.status}`);
  return r.json();
}

export async function getConversation(
  videoId: string, convId: string
): Promise<Conversation> {
  const r = await fetch(`${BASE}/videos/${videoId}/conversations/${convId}`);
  if (!r.ok) throw new Error(`API error ${r.status}`);
  return r.json();
}

export async function sendChatMessage(
  videoId: string,
  convId: string,
  content: string,
  analysisId?: string
): Promise<SendMessageResponse> {
  const r = await fetch(`${BASE}/videos/${videoId}/conversations/${convId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, analysis_id: analysisId ?? null }),
  });
  if (!r.ok) throw new Error(`API error ${r.status}`);
  return r.json();
}

export async function deleteConversation(videoId: string, convId: string): Promise<void> {
  await fetch(`${BASE}/videos/${videoId}/conversations/${convId}`, { method: "DELETE" });
}

export async function renameConversation(
  videoId: string, convId: string, title: string
): Promise<void> {
  await fetch(`${BASE}/videos/${videoId}/conversations/${convId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
}
