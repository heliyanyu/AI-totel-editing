# -*- coding: utf-8 -*-
"""Generate JianYing draft with matched Nucleus assets.

Reads asset_matches.json from the case out dir, maps matched segments
to the output timeline via blueprint atoms + timing_map, and generates
a draft with an asset track.

Usage:
  python scripts/generate-draft-from-matches.py <case_out_dir> [--target <drafts_dir>]
"""

import json
import os
import re
import sys
from pathlib import Path

from pyJianYingDraft import (
    DraftFolder,
    TrackType,
    Timerange,
    VideoSegment,
    TextSegment,
    TextStyle,
    ClipSettings,
    SEC,
)

ASSET_ROOT = Path("P:/团队空间/公司通用/AIkaifa/nucleus/cardiology")


def parse_srt(srt_path: str) -> list:
    content = Path(srt_path).read_text(encoding="utf-8")
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
        text = "\n".join(lines[2:])
        subs.append({"start": start, "end": end, "text": text})
    return subs


def build_atom_output_times(timing_map: dict) -> dict:
    """Build atom_id -> {start, end} in output timeline."""
    atom_times = {}
    for seg in timing_map.get("segments", []):
        atom_times[seg["atom_id"]] = seg["output"]
    return atom_times


def get_logic_segment_time(ls: dict, atom_times: dict) -> tuple:
    """Get (start_sec, end_sec) of a logic segment in output timeline."""
    keep_atoms = [a for a in ls.get("atoms", []) if a.get("status") == "keep"]
    if not keep_atoms:
        return None, None
    atom_ids = [a["id"] for a in keep_atoms]
    times = [atom_times[aid] for aid in atom_ids if aid in atom_times]
    if not times:
        return None, None
    return min(t["start"] for t in times), max(t["end"] for t in times)


def main():
    if len(sys.argv) < 2:
        print("Usage: python scripts/generate-draft-from-matches.py <case_out_dir> [--target <drafts_dir>]")
        sys.exit(1)

    out_dir = Path(sys.argv[1]).resolve()

    target_dir = None
    for i, arg in enumerate(sys.argv):
        if arg == "--target" and i + 1 < len(sys.argv):
            target_dir = Path(sys.argv[i + 1])

    # Required files
    source_video = out_dir / "source_direct_cut_video.mp4"
    srt_file = out_dir / "subtitles.srt"
    timing_map_file = out_dir / "timing_map.json"
    blueprint_file = out_dir / "blueprint.json"
    # Prefer v2 matches > atoms > original
    matches_file = out_dir / "asset_matches_v2.json"
    if not matches_file.exists():
        matches_file = out_dir / "asset_matches_atoms.json"
    if not matches_file.exists():
        matches_file = out_dir / "asset_matches.json"
    scene_manifest = out_dir / "overlay_scenes" / "manifest.json"
    overlay_video = out_dir / "overlay.mp4"
    pb_mp4 = out_dir / "overlay_progress_bar.mp4"
    nav_manifest = out_dir / "nav_scenes" / "manifest.json"

    for f in [source_video, srt_file, timing_map_file, blueprint_file, matches_file]:
        if not f.exists():
            print(f"Error: missing {f}")
            sys.exit(1)

    timing_map = json.loads(timing_map_file.read_text(encoding="utf-8"))
    bp = json.loads(blueprint_file.read_text(encoding="utf-8"))
    matches = json.loads(matches_file.read_text(encoding="utf-8"))

    total_duration = timing_map.get("totalDuration", 0)
    total_us = int(total_duration * SEC) - 10000

    atom_times = build_atom_output_times(timing_map)

    # Build seg_id -> logic_segment lookup from blueprint
    seg_id_to_ls = {}
    for scene in bp["scenes"]:
        for ls in scene.get("logic_segments", []):
            seg_id_to_ls[ls["id"]] = ls

    # Build asset clips from matches (support both v1 picked_segments and v2 picked)
    asset_clips = []
    for m in matches.get("matches", []):
        if not m.get("needs_animation"):
            continue

        # v2 format: "picked" is a single object with file/start/end
        # v1 format: "picked_segments" is an array
        picked = m.get("picked")
        if not picked:
            picked_segments = m.get("picked_segments", [])
            if picked_segments:
                picked = picked_segments[0]
            else:
                continue

        seg_id = m["seg_id"]
        ls = seg_id_to_ls.get(seg_id)
        if not ls:
            continue

        start_sec, end_sec = get_logic_segment_time(ls, atom_times)
        if start_sec is None:
            continue

        asset_path = ASSET_ROOT / picked["file"]
        if not asset_path.exists():
            print(f"  [WARN] asset not found: {asset_path}")
            continue

        asset_clips.append({
            "seg_id": seg_id,
            "output_start": start_sec,
            "output_end": end_sec,
            "asset_path": str(asset_path),
            "asset_start": picked["start"],
            "asset_end": picked["end"],
            "items": m.get("items", []),
            "relevance": picked.get("relevance", picked.get("reason", "")),
        })

    print(f"Blueprint: {bp['title']}")
    print(f"Duration: {total_duration:.1f}s")
    print(f"Asset clips to place: {len(asset_clips)}")
    for ac in asset_clips:
        print(f"  {ac['seg_id']} [{ac['output_start']:.2f}-{ac['output_end']:.2f}s] → {Path(ac['asset_path']).name[:50]} [{ac['asset_start']:.1f}-{ac['asset_end']:.1f}s]")

    # Generate draft
    case_dir = out_dir.parent if out_dir.name == "out" else out_dir
    # Use timestamp suffix to avoid name collision with locked drafts
    import time as _time
    ts = _time.strftime("%m%d%H%M")
    draft_name = f"{case_dir.name}_matched_{ts}"
    draft_parent = target_dir if target_dir else out_dir
    draft_parent.mkdir(parents=True, exist_ok=True)

    folder = DraftFolder(str(draft_parent))
    script = folder.create_draft(draft_name, 1080, 1920, 30, allow_replace=True)

    # Track 1: main video
    script.add_track(TrackType.video, "main")
    script.add_segment(VideoSegment(
        str(source_video),
        target_timerange=Timerange(0, total_us),
    ), "main")
    print("  + main track")

    # Track 2: overlay
    script.add_track(TrackType.video, "overlay", relative_index=1)
    has_scene_clips = scene_manifest.exists()
    if has_scene_clips:
        scene_clips = json.loads(scene_manifest.read_text(encoding="utf-8"))
        scenes_dir = out_dir / "overlay_scenes"
        prev_end = 0
        for sc in scene_clips:
            clip_path = scenes_dir / sc["filename"]
            if not clip_path.exists():
                continue
            start_us = max(int(sc["start"] * SEC), prev_end)
            dur_us = int(sc["duration"] * SEC) - (start_us - int(sc["start"] * SEC))
            if dur_us <= 0:
                continue
            script.add_segment(VideoSegment(
                str(clip_path),
                target_timerange=Timerange(start_us, dur_us),
            ), "overlay")
            prev_end = start_us + dur_us
        print(f"  + overlay track ({len(scene_clips)} clips)")
    elif overlay_video.exists():
        script.add_segment(VideoSegment(
            str(overlay_video),
            target_timerange=Timerange(0, total_us),
        ), "overlay")
        print("  + overlay track (single file)")

    # Track 3: progress bar
    if pb_mp4.exists():
        script.add_track(TrackType.video, "progress_bar", relative_index=2)
        pb_position = ClipSettings(transform_y=-0.948)
        script.add_segment(VideoSegment(
            str(pb_mp4),
            target_timerange=Timerange(0, total_us),
            clip_settings=pb_position,
        ), "progress_bar")
        print("  + progress bar track")

    # Track 4: navigation
    if nav_manifest.exists():
        nav_clips = json.loads(nav_manifest.read_text(encoding="utf-8"))
        nav_dir = out_dir / "nav_scenes"
        script.add_track(TrackType.video, "navigation", relative_index=3)
        for nc in nav_clips:
            clip_path = nav_dir / nc["filename"]
            if not clip_path.exists():
                continue
            dur_us = int(nc["duration"] * SEC)
            if dur_us <= 0:
                continue
            script.add_segment(VideoSegment(
                str(clip_path),
                target_timerange=Timerange(int(nc["start"] * SEC), dur_us),
            ), "navigation")
        print(f"  + navigation track ({len(nav_clips)} clips)")

    # Track 5: MATCHED ASSETS
    if asset_clips:
        script.add_track(TrackType.video, "assets", relative_index=4)
        for ac in asset_clips:
            output_start_us = int(ac["output_start"] * SEC)
            output_dur_us = int((ac["output_end"] - ac["output_start"]) * SEC)
            # Source trimming: start from asset_start within the source video
            source_start_us = int(ac["asset_start"] * SEC)
            if output_dur_us <= 0:
                continue
            script.add_segment(VideoSegment(
                ac["asset_path"],
                target_timerange=Timerange(output_start_us, output_dur_us),
                source_timerange=Timerange(source_start_us, output_dur_us),
            ), "assets")
        print(f"  + assets track ({len(asset_clips)} clips)")

    # Track 6: subtitles
    subs = parse_srt(str(srt_file))
    script.add_track(TrackType.text, "subs")
    style = TextStyle(size=8.0, color=(1.0, 1.0, 1.0))
    sub_position = ClipSettings(transform_y=0.5)
    for sub in subs:
        duration = sub["end"] - sub["start"]
        if duration <= 0.01:
            continue
        script.add_segment(TextSegment(
            sub["text"],
            timerange=Timerange(int(sub["start"] * SEC), int(duration * SEC)),
            style=style,
            clip_settings=sub_position,
        ), "subs")
    print(f"  + subtitle track ({len(subs)} entries)")

    script.save()
    print(f"\n  -> {draft_parent / draft_name}")


if __name__ == "__main__":
    main()
