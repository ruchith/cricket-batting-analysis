# Feature Roadmap

Ideas for future development, grouped by theme.

---

## Analysis Quality

- **Bat tracking** — detect the bat using a fine-tuned YOLO model; compute bat
  speed, swing angle, and follow-through arc
- **Multi-frame shot segmentation** — automatically detect the start/end of the
  shot rather than relying on the full clip
- **Confidence heatmaps** — show which frames had low pose landmark confidence
  so the user knows when metrics are unreliable
- **Side-on vs bowler's-end detection** — auto-detect camera angle and warn if
  the angle is suboptimal for analysis

---

## Feedback & Coaching

- **Drill video library** — when Claude recommends a drill, link to a short
  reference clip demonstrating it
- **Progress tracking** — compare metrics across multiple sessions for the same
  batter (stance width trend, stride length improvement over time)
- **Benchmark comparison** — compare the batter's metrics against stored
  profiles of known shot types (e.g. a "textbook cover drive" reference
  skeleton)
- **Overlay comparison** — ghost-overlay the batter's skeleton against a
  reference skeleton frame-by-frame

---

## User Experience

- **User accounts / multi-batter profiles** — separate libraries per batter,
  useful for coaches managing a squad
- **Shareable report** — generate a PDF or shareable link with the analysis
  summary and key frames
- **Clip trimming in-browser** — let the user trim to just the shot before
  uploading, reducing processing time and improving pose accuracy
- **Frame-by-frame scrubber** — show skeleton keypoints live as the user scrubs
  through the video timeline

---

## Infrastructure

- **Background job queue visibility** — show estimated wait time when the worker
  is busy with other jobs
- **Webhook / push notification** — notify the user (email or mobile push) when
  a long analysis completes
- **File size and magic-byte validation** — validate video file headers before
  passing to ffmpeg (see Security Notes in README)
- **Rate limiting** — cap uploads per IP to prevent resource exhaustion on
  shared deployments

---

## Priority Note

**Progress tracking across sessions** is likely the highest-ROI item: it turns
a one-shot analysis tool into something a batter returns to regularly. The per-
video data is already stored in the library; the main work is a timeline view
and a metrics diff component in the frontend.
