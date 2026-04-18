"""Generate a self-contained HTML analysis report for a player."""
from __future__ import annotations

import json
import time
from pathlib import Path


def _fmt_ts(ts: float) -> str:
    return time.strftime("%d %B %Y", time.localtime(ts))


def _metric_row(label: str, value: object, unit: str = "") -> str:
    if value is None:
        display = '<span class="na">—</span>'
    else:
        display = f"{value:.3f}{unit}" if isinstance(value, float) else f"{value}{unit}"
    return f"<tr><td>{label}</td><td>{display}</td></tr>"


def _badge(confidence: str) -> str:
    colors = {"high": "#16a34a", "medium": "#ca8a04", "low": "#dc2626"}
    c = colors.get(confidence, "#6b7280")
    return f'<span class="badge" style="background:{c}">{confidence}</span>'


def _list_section(title: str, emoji: str, color: str, items: list[str]) -> str:
    if not items:
        return ""
    lis = "".join(f"<li>{i}</li>" for i in items)
    return f"""
    <div class="feedback-block">
      <h4><span class="emoji">{emoji}</span> {title}</h4>
      <ul style="border-left-color:{color}">{lis}</ul>
    </div>"""


def generate_report(
    video_meta: dict,
    analysis: dict | None,
    insights: dict | None,
    segmentation: dict | None,
    analysis_id: str,
) -> str:
    filename = video_meta.get("filename", "Unknown")
    created_at = video_meta.get("created_at", time.time())
    date_str = _fmt_ts(created_at)

    cf = (insights or {}).get("coaching_feedback", {})
    sc = (insights or {}).get("shot_classification", {})
    vision = (insights or {}).get("vision_review", [])
    impact = (insights or {}).get("impact_vision", [])
    all_frames = vision + impact

    shot_type = sc.get("shot_type", "Unknown").title() if sc else "—"
    shot_conf = sc.get("confidence", "") if sc else ""
    shot_reasoning = sc.get("reasoning", "") if sc else ""

    # Metrics table rows
    metrics_html = ""
    if analysis:
        metrics_html = f"""
        <table class="metrics-table">
          <thead><tr><th>Metric</th><th>Value</th></tr></thead>
          <tbody>
            {_metric_row("Stance Width (normalised)", analysis.get("stance_width_normalized"))}
            {_metric_row("Head Stillness Variance", analysis.get("head_stillness_variance"))}
            {_metric_row("Backlift Peak Height", analysis.get("backlift_peak_height"))}
            {_metric_row("Front Foot Stride", analysis.get("front_foot_stride_length"))}
            {_metric_row("Head Over Front Foot", analysis.get("head_over_front_foot"))}
            {_metric_row("Impact Frame", analysis.get("impact_frame"))}
          </tbody>
        </table>"""

    # Shot window
    shot_window_html = ""
    if segmentation:
        ss = segmentation.get("shot_start_ts", "")
        se = segmentation.get("shot_end_ts", "")
        peak = segmentation.get("peak_ts", "")
        shot_window_html = f"""
        <table class="metrics-table">
          <thead><tr><th>Event</th><th>Timestamp</th></tr></thead>
          <tbody>
            <tr><td>Shot Start</td><td>{f"{ss:.2f}s" if ss != "" else "—"}</td></tr>
            <tr><td>Peak Backlift</td><td>{f"{peak:.2f}s" if peak != "" else "—"}</td></tr>
            <tr><td>Shot End</td><td>{f"{se:.2f}s" if se != "" else "—"}</td></tr>
          </tbody>
        </table>"""

    # Coaching feedback sections
    feedback_html = ""
    if cf:
        feedback_html = (
            _list_section("Strengths", "✅", "#16a34a", cf.get("strengths", []))
            + _list_section("Areas to Improve", "⚠️", "#dc2626", cf.get("issues", []))
            + _list_section("Focus Areas", "🎯", "#2563eb", cf.get("focus_areas", []))
            + _list_section("Corrective Actions", "🔧", "#7c3aed", cf.get("corrective_actions", []))
            + _list_section("Recommended Drills", "🏋️", "#ca8a04", cf.get("drills", []))
        )

    # Frame observations
    frames_html = ""
    if all_frames:
        cards = ""
        for frame in all_frames:
            label = frame.get("frame_label", "")
            obs = frame.get("observations", [])
            lis = "".join(f"<li>{o}</li>" for o in obs)
            cards += f"""
            <div class="frame-card">
              <p class="frame-label">{label.replace("_", " ").title()}</p>
              <ul>{lis}</ul>
            </div>"""
        frames_html = f'<div class="frame-grid">{cards}</div>'

    shot_block = ""
    if sc:
        shot_block = f"""
        <div class="shot-block">
          <span class="shot-name">{shot_type}</span>
          {_badge(shot_conf)}
          <p class="shot-reasoning">{shot_reasoning}</p>
        </div>"""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Cricket Batting Analysis — {filename}</title>
  <style>
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}

    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f8fafc;
      color: #1e293b;
      line-height: 1.6;
    }}

    .page {{ max-width: 860px; margin: 0 auto; padding: 2rem 1.5rem 4rem; }}

    /* Header */
    .report-header {{
      background: linear-gradient(135deg, #14532d 0%, #166534 60%, #15803d 100%);
      color: white;
      border-radius: 16px;
      padding: 2.5rem 2rem 2rem;
      margin-bottom: 2rem;
      position: relative;
      overflow: hidden;
    }}
    .report-header::after {{
      content: "🏏";
      position: absolute;
      right: 2rem;
      top: 1.5rem;
      font-size: 5rem;
      opacity: 0.15;
    }}
    .report-header h1 {{ font-size: 1.6rem; font-weight: 700; margin-bottom: 0.25rem; }}
    .report-header .meta {{ font-size: 0.85rem; opacity: 0.8; }}
    .report-header .analysis-id {{ font-size: 0.7rem; opacity: 0.5; font-family: monospace; margin-top: 0.5rem; }}

    /* Sections */
    .section {{ margin-bottom: 2rem; }}
    .section-title {{
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #64748b;
      margin-bottom: 0.75rem;
      padding-bottom: 0.4rem;
      border-bottom: 1px solid #e2e8f0;
    }}

    /* Shot block */
    .shot-block {{
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 1.25rem 1.5rem;
    }}
    .shot-name {{ font-size: 1.4rem; font-weight: 700; margin-right: 0.5rem; }}
    .badge {{
      display: inline-block;
      color: white;
      font-size: 0.7rem;
      font-weight: 600;
      padding: 0.15rem 0.6rem;
      border-radius: 999px;
      vertical-align: middle;
      text-transform: uppercase;
    }}
    .shot-reasoning {{ color: #64748b; font-size: 0.9rem; margin-top: 0.5rem; }}

    /* Metrics table */
    .metrics-table {{ width: 100%; border-collapse: collapse; background: white; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; }}
    .metrics-table th {{ background: #f1f5f9; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; padding: 0.6rem 1rem; text-align: left; }}
    .metrics-table td {{ padding: 0.6rem 1rem; font-size: 0.9rem; border-top: 1px solid #f1f5f9; }}
    .metrics-table tr:hover td {{ background: #f8fafc; }}
    .na {{ color: #cbd5e1; }}

    /* Feedback */
    .feedback-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }}
    @media (max-width: 600px) {{ .feedback-grid {{ grid-template-columns: 1fr; }} }}
    .feedback-block {{
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 1rem 1.25rem;
    }}
    .feedback-block h4 {{
      font-size: 0.8rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #475569;
      margin-bottom: 0.6rem;
    }}
    .emoji {{ margin-right: 0.3rem; }}
    .feedback-block ul {{
      list-style: none;
      border-left: 3px solid;
      padding-left: 0.85rem;
    }}
    .feedback-block li {{
      font-size: 0.875rem;
      color: #334155;
      padding: 0.2rem 0;
    }}
    .feedback-block li + li {{ border-top: 1px solid #f1f5f9; }}

    /* Frame observations */
    .frame-grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 1rem; }}
    .frame-card {{
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 1rem 1.25rem;
    }}
    .frame-label {{
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #94a3b8;
      margin-bottom: 0.5rem;
      font-family: monospace;
    }}
    .frame-card ul {{ list-style: none; }}
    .frame-card li {{
      font-size: 0.85rem;
      color: #334155;
      padding: 0.2rem 0;
      border-top: 1px solid #f1f5f9;
      padding-left: 0.75rem;
      position: relative;
    }}
    .frame-card li::before {{ content: "·"; position: absolute; left: 0; color: #94a3b8; }}

    /* Footer */
    .report-footer {{
      text-align: center;
      font-size: 0.75rem;
      color: #94a3b8;
      margin-top: 3rem;
      padding-top: 1.5rem;
      border-top: 1px solid #e2e8f0;
    }}
  </style>
</head>
<body>
  <div class="page">

    <div class="report-header">
      <h1>{filename}</h1>
      <p class="meta">Analysis Report · {date_str}</p>
      <p class="analysis-id">Analysis ID: {analysis_id}</p>
    </div>

    {"" if not sc else f'''
    <div class="section">
      <p class="section-title">Shot Classification</p>
      {shot_block}
    </div>'''}

    {"" if not analysis else f'''
    <div class="section">
      <p class="section-title">Biomechanical Metrics</p>
      {metrics_html}
    </div>'''}

    {"" if not segmentation else f'''
    <div class="section">
      <p class="section-title">Shot Window</p>
      {shot_window_html}
    </div>'''}

    {"" if not cf else f'''
    <div class="section">
      <p class="section-title">Coaching Feedback</p>
      <div class="feedback-grid">
        {feedback_html}
      </div>
    </div>'''}

    {"" if not all_frames else f'''
    <div class="section">
      <p class="section-title">Frame-by-Frame Observations</p>
      {frames_html}
    </div>'''}

    <div class="report-footer">
      Generated by Cricket Batting Analysis &nbsp;·&nbsp; {date_str}
    </div>

  </div>
</body>
</html>"""
