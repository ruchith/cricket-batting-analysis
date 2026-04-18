# LLM Prompt Templates

This file documents every prompt used by the system, what it's designed to
produce, and notes for future iteration.

---

## 1. Coaching Feedback (Haiku)

**File:** `backend/app/pipeline/llm_client.py` → `generate_coaching_feedback()`
**Model:** `claude-haiku-4-5-20251001`

**Purpose:** Rephrase numeric biomechanical metrics into actionable coaching
language. Structured strengths/issues/drills JSON.

**Template:**
```
You are an expert cricket batting coach. Below are biomechanical metrics
computed from a video analysis. Provide coaching feedback STRICTLY based on
these numbers. Do NOT invent measurements or reference values not provided below.

METRICS:
{json.dumps(metrics, indent=2)}

Respond with valid JSON matching this exact schema:
{
  "strengths": ["<strength 1>", ...],
  "issues": ["<issue 1>", ...],
  "drills": ["<drill 1>", ...]
}

Use 2-4 items per list. Be specific and actionable. Mention the actual metric values.
```

**Output shape:**
```json
{
  "strengths": ["string", ...],
  "issues": ["string", ...],
  "drills": ["string", ...]
}
```

**Why this design:**
- Injecting raw metrics as structured JSON prevents hallucination of numbers.
- "STRICTLY based on these numbers" + "Do NOT invent" dual instruction reduces
  confabulation.
- Asking for actual metric values in each point keeps the output grounded.
- 2-4 items per list keeps it scannable in the UI.

**Iteration notes:**
- If Haiku tends to be too generic ("maintain good balance"), add a few-shot
  example of a specific, metric-grounded coaching point.
- If output includes markdown instead of JSON, the parser strips ```json blocks.
- Consider adding domain-specific context: "A stance width of 1.2× shoulder width
  is typical for a cover drive; 1.5× is more common for a pull shot."

---

## 2. Shot Classification (Sonnet)

**File:** `backend/app/pipeline/llm_client.py` → `classify_shot()`
**Model:** `claude-sonnet-4-6`

**Purpose:** Identify the type of shot being played from a compact joint-angle
trajectory summary.

**Template:**
```
You are an expert cricket analyst. Below is a summary of a batter's
pose trajectory at 10 key frames (joint angles in degrees).

{pose_summary}

Based purely on the pose kinematics, classify the shot being played.
Choose from: cover drive, straight drive, on drive, pull shot, hook shot, cut shot,
sweep shot, defensive push, forward defensive, backward defensive, flick, glance.

Respond with valid JSON:
{
  "shot_type": "<shot name>",
  "confidence": "high|medium|low",
  "reasoning": "<1-2 sentence explanation>"
}
```

**Output shape:**
```json
{
  "shot_type": "cover drive",
  "confidence": "high",
  "reasoning": "The rightward elbow extension at 0.45s combined with 130° knee..."
}
```

**Why this design:**
- Providing the pre-computed angle trajectory offloads numeric extraction from
  the LLM. The model only needs to classify.
- Enumerating shot types prevents free-form hallucination like "a beautiful shot".
- Confidence field allows the UI to communicate uncertainty.
- "Based purely on pose kinematics" discourages guessing from video metadata.

**Iteration notes:**
- 10 key frames is a balance between token cost and information density. Increase
  to 15 if confidence is consistently "low" on real videos.
- Add elbow and wrist velocity (frame delta) to the summary if shot classification
  proves unreliable — bat speed direction is a strong cue.
- If swing-leg vs. plant-leg is misidentified, add explicit "left-handed / right-
  handed batter" detection from stance metrics.

---

## 3. Vision Review (Sonnet)

**File:** `backend/app/pipeline/llm_client.py` → `vision_review_frames()`
**Model:** `claude-sonnet-4-6` (multimodal)

**Purpose:** Qualitative observations from 2-3 key frames about aspects that
pose keypoints cannot capture: bat face angle, eye level, weight transfer.

**Template (text part after images):**
```
As an expert cricket batting coach, analyze these key frames.
Focus on what pose keypoints miss: bat face angle, eye level relative to ball
trajectory, weight transfer cues, head position, grip, and footwork quality.

Respond with valid JSON array:
[
  {
    "frame_label": "<label>",
    "observations": ["<obs 1>", "<obs 2>", ...]
  }
]

Provide 3-5 observations per frame. Be specific about what you observe.
```

**Images sent:** JPEG frames at quality 85, typically 640–1280px wide.
Three frames: `start_of_backlift`, `top_of_backlift`, `mid_shot`
(plus `impact_frame_N` if user marked impact).

**Output shape:**
```json
[
  {
    "frame_label": "start_of_backlift",
    "observations": [
      "Bat face is closed slightly at 10° to the off-side at backlift start",
      "Eyes are level with the pitch crease line — good alignment",
      "Weight is evenly distributed between both feet"
    ]
  }
]
```

**Why this design:**
- Interleaving `text → image → text → image → text → prompt` is the standard
  Anthropic multi-image pattern. Each image is labelled so responses can be
  matched back to frames.
- JPEG quality 85 reduces token cost vs. PNG while retaining enough detail for
  qualitative review.
- "Focus on what pose keypoints miss" steers the model away from repeating what
  the Metrics tab already shows.
- 3-5 observations per frame keeps the Shot tab scannable.

**Iteration notes:**
- If the model describes background noise instead of the batter, crop frames
  to a bounding box around the detected pose skeleton.
- If observations are too generic ("the batter appears to be in a good position"),
  add a few-shot example with specific, visual language.
- Consider sending frames at half resolution (640px) to halve vision token cost —
  bat face angle is visible at lower resolution.

---

## 4. Impact Frame Vision (Sonnet)

**File:** `backend/app/api/routes.py` → `_impact_vision()`
**Model:** `claude-sonnet-4-6` (multimodal)
**Triggered by:** User clicking "Mark Impact Frame" in UI.

Uses the same `vision_review_frames()` function as above, passing a single
frame labelled `impact_frame_{N}`.

**Iteration notes:**
- This is a follow-up call — the batter has already seen the main vision review.
  Consider adding coaching context from the earlier analysis: "Previous analysis
  suggested a stance width of 1.3×. At impact, comment on whether this appears
  maintained."
- Impact frames tend to have motion blur. Consider asking for a frame ±2 frames
  from the marked frame and selecting the sharpest.
