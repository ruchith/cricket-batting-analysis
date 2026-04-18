import type { JobResponse } from "./types";

const BASE = "/api";

export async function uploadVideo(
  file: File,
  onProgress: (pct: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file);

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const data = JSON.parse(xhr.responseText);
        resolve(data.job_id);
      } else {
        reject(new Error(`Upload failed: ${xhr.status} ${xhr.responseText}`));
      }
    });

    xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
    xhr.open("POST", `${BASE}/jobs`);
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

export async function markImpact(
  jobId: string,
  frameIndex: number
): Promise<{ analysis: Record<string, unknown> }> {
  const r = await fetch(`${BASE}/jobs/${jobId}/impact`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ frame_index: frameIndex }),
  });
  if (!r.ok) throw new Error(`Impact API error ${r.status}`);
  return r.json();
}

export async function sendFeedback(
  jobId: string,
  insightId: string,
  useful: boolean
): Promise<void> {
  await fetch(`${BASE}/jobs/${jobId}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ insight_id: insightId, useful }),
  });
}
