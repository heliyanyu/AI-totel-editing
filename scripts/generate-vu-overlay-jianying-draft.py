# -*- coding: utf-8 -*-
"""Generate a Jianying draft with the new VU templates replacing the old overlay.

Keeps the old pipeline's:
  - real source video
  - progress bar
  - navigation
  - real subtitles

Replaces only the old overlay track with the rendered VU template videos, placed
on the timeline according to the V4 visual-unit timing file.

Usage:
  python scripts/generate-vu-overlay-jianying-draft.py
  python scripts/generate-vu-overlay-jianying-draft.py --case-out <case_out_dir>
"""

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, r"F:/miniconda3/envs/agent/Lib/site-packages")

from pyJianYingDraft import (  # noqa: E402
    ClipSettings,
    DraftFolder,
    SEC,
    TextSegment,
    TextStyle,
    Timerange,
    TrackType,
    VideoMaterial,
    VideoSegment,
)


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CASE_OUT = Path(
    r"P:/团队空间/公司通用/AIkaifa/AI total editing/260403/wangningjuan/mengxiangen/mianyili 03/out"
)
DEFAULT_VU_FILE = ROOT / "local_artifacts" / "mianyili_03.visual_units.state_v4.manual.json"
DEFAULT_VU_VIDEO_DIR = ROOT / "local_artifacts" / "review_videos_mianyili_03_final"
DEFAULT_TARGET = ROOT / "local_artifacts" / "jianying_demo"
DEFAULT_DRAFT_NAME = "mianyili_03_vu_overlay_replacement_draft"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--case-out", default=str(DEFAULT_CASE_OUT))
    parser.add_argument("--vu-file", default=str(DEFAULT_VU_FILE))
    parser.add_argument("--vu-video-dir", default=str(DEFAULT_VU_VIDEO_DIR))
    parser.add_argument("--target", default=str(DEFAULT_TARGET))
    parser.add_argument("--draft-name", default=DEFAULT_DRAFT_NAME)
    return parser.parse_args()


def parse_srt(srt_path: Path) -> list[dict]:
    content = srt_path.read_text(encoding="utf-8")
    blocks = re.split(r"\n\s*\n", content.strip())
    subs = []
    for block in blocks:
        lines = block.strip().split("\n")
        if len(lines) < 3:
            continue
        m = re.match(
            r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})",
            lines[1],
        )
        if not m:
            continue
        g = [int(x) for x in m.groups()]
        start = g[0] * 3600 + g[1] * 60 + g[2] + g[3] / 1000.0
        end = g[4] * 3600 + g[5] * 60 + g[6] + g[7] / 1000.0
        subs.append({"start": start, "end": end, "text": "\n".join(lines[2:])})
    return subs


def make_video_material(path: str, duration_us: int, width: int = 1080, height: int = 1920) -> VideoMaterial:
    """Construct a VideoMaterial manually for files that pymediainfo may not read."""
    import os
    import uuid

    from pyJianYingDraft import CropSettings

    mat = object.__new__(VideoMaterial)
    mat.material_id = uuid.uuid4().hex
    mat.local_material_id = ""
    mat.material_name = os.path.basename(path)
    mat.path = str(Path(path).absolute())
    mat.duration = duration_us
    mat.width = width
    mat.height = height
    mat.material_type = "video"
    mat.crop_settings = CropSettings()
    return mat


def find_existing(*paths: Path) -> Path | None:
    for path in paths:
        if path.exists():
            return path
    return None


def index_vu_videos(video_dir: Path) -> dict[str, Path]:
    mapping = {}
    for path in sorted(video_dir.glob("*.mp4")):
        m = re.search(r"(S?VU\d{2})", path.name)
        if m:
            vu_id = m.group(1)
            mapping[vu_id] = path
            if vu_id.startswith("SVU"):
                mapping[vu_id[1:]] = path
    return mapping


def add_navigation_track(script, out_dir: Path, total_us: int) -> None:
    navigation_video = out_dir / "overlay_navigation.mp4"
    nav_py_manifest = out_dir / "nav_scenes" / "overlay_navigation_manifest.json"
    nav_legacy_manifest = out_dir / "nav_scenes" / "manifest.json"
    nav_dir = out_dir / "nav_scenes"

    if nav_py_manifest.exists():
        nav_clips = json.loads(nav_py_manifest.read_text(encoding="utf-8"))
        script.add_track(TrackType.video, "navigation", relative_index=3)
        added = 0
        for nc in nav_clips:
            clip_path = nav_dir / nc["file"]
            if not clip_path.exists():
                continue
            dur_us = int(nc["durationSec"] * SEC)
            if dur_us <= 0:
                continue
            script.add_segment(
                VideoSegment(
                    str(clip_path),
                    target_timerange=Timerange(int(nc["startSec"] * SEC), dur_us),
                    volume=0,
                ),
                "navigation",
            )
            added += 1
        print(f"  + navigation track ({added} clips, Python-rendered)")
    elif nav_legacy_manifest.exists():
        nav_clips = json.loads(nav_legacy_manifest.read_text(encoding="utf-8"))
        script.add_track(TrackType.video, "navigation", relative_index=3)
        prev_end = 0
        added = 0
        for nc in nav_clips:
            clip_path = nav_dir / nc["filename"]
            if not clip_path.exists():
                continue
            start_us = max(int(nc["start"] * SEC), prev_end)
            dur_us = int(nc["duration"] * SEC) - (start_us - int(nc["start"] * SEC))
            if dur_us <= 0:
                continue
            script.add_segment(
                VideoSegment(str(clip_path), target_timerange=Timerange(start_us, dur_us), volume=0),
                "navigation",
            )
            prev_end = start_us + dur_us
            added += 1
        print(f"  + navigation track ({added} scene clips)")
    elif navigation_video.exists():
        script.add_track(TrackType.video, "navigation", relative_index=3)
        mat = make_video_material(str(navigation_video), total_us)
        script.add_material(mat)
        script.add_segment(
            VideoSegment(mat, target_timerange=Timerange(0, total_us), volume=0),
            "navigation",
        )
        print("  + navigation track (single file)")


def main() -> None:
    args = parse_args()
    out_dir = Path(args.case_out).resolve()
    vu_file = Path(args.vu_file).resolve()
    vu_video_dir = Path(args.vu_video_dir).resolve()
    target = Path(args.target).resolve()

    source_video = out_dir / "source_direct_cut_video.mp4"
    srt_file = out_dir / "subtitles.srt"
    timing_map_file = out_dir / "timing_map.json"

    for path in [source_video, srt_file, timing_map_file, vu_file, vu_video_dir]:
        if not path.exists():
            raise SystemExit(f"Missing required input: {path}")

    vu_data = json.loads(vu_file.read_text(encoding="utf-8"))
    visual_units = vu_data["visual_units"]
    vu_videos = index_vu_videos(vu_video_dir)

    timing_map = json.loads(timing_map_file.read_text(encoding="utf-8"))
    source_material = VideoMaterial(str(source_video))
    total_us = min(int(timing_map.get("totalDuration", 0) * SEC), source_material.duration)

    target.mkdir(parents=True, exist_ok=True)
    folder = DraftFolder(str(target))
    script = folder.create_draft(args.draft_name, 1080, 1920, 30, allow_replace=True)

    print(f"Draft: {args.draft_name} ({total_us / SEC:.1f}s)")

    # Track 1: real source video, unchanged from the old pipeline.
    script.add_track(TrackType.video, "main")
    script.add_segment(
        VideoSegment(source_material, target_timerange=Timerange(0, total_us)),
        "main",
    )
    print("  + main source video")

    # Track 2: new VU template overlay, replacing the old overlay track.
    script.add_track(TrackType.video, "overlay_vu_templates", relative_index=1)
    added_vu = 0
    missing_vu = []
    for vu in visual_units:
        vu_id = vu["id"]
        video = vu_videos.get(vu_id)
        if not video:
            if vu.get("attention_owner") == "doctor" or "主播口播" in str(vu.get("presentation_strategy", "")):
                continue
            missing_vu.append(vu_id)
            continue
        start_us = int(vu["time"]["start"] * SEC)
        end_us = int(vu["time"]["end"] * SEC)
        start_us = max(0, min(start_us, total_us - 1))
        end_us = max(start_us + 1, min(end_us, total_us))
        dur_us = end_us - start_us
        material = VideoMaterial(str(video))
        source_dur = min(dur_us, material.duration)
        script.add_segment(
            VideoSegment(
                material,
                target_timerange=Timerange(start_us, dur_us),
                source_timerange=Timerange(0, source_dur),
                volume=0,
            ),
            "overlay_vu_templates",
        )
        added_vu += 1
    print(f"  + VU template overlay track ({added_vu} clips)")
    if missing_vu:
        print(f"  ! missing VU videos: {', '.join(missing_vu)}")

    # Track 3: old progress bar, kept.
    pb_video = find_existing(out_dir / "overlay_progress_bar.mp4", out_dir / "overlay_progress_bar.mov")
    if pb_video:
        script.add_track(TrackType.video, "progress_bar", relative_index=2)
        pb_material = VideoMaterial(str(pb_video))
        pb_position = ClipSettings(transform_y=(pb_material.height / 2 - 960) / 960)
        script.add_segment(
            VideoSegment(
                pb_material,
                target_timerange=Timerange(0, total_us),
                volume=0,
                clip_settings=pb_position,
            ),
            "progress_bar",
        )
        print(f"  + progress bar track ({pb_video.name})")

    # Track 4: old navigation, kept.
    add_navigation_track(script, out_dir, total_us)

    # Track 5: old real subtitles, kept and placed above the template overlay.
    subs = parse_srt(srt_file)
    script.add_track(TrackType.text, "subs", relative_index=4)
    style = TextStyle(size=8.0, color=(1.0, 1.0, 1.0))
    sub_position = ClipSettings(transform_y=0.5)
    added_subs = 0
    for sub in subs:
        duration = sub["end"] - sub["start"]
        if duration <= 0.01:
            continue
        script.add_segment(
            TextSegment(
                sub["text"],
                timerange=Timerange(int(sub["start"] * SEC), int(duration * SEC)),
                style=style,
                clip_settings=sub_position,
            ),
            "subs",
        )
        added_subs += 1
    print(f"  + subtitle track ({added_subs} entries)")

    script.save()
    print(f"  -> {target / args.draft_name}")


if __name__ == "__main__":
    main()
