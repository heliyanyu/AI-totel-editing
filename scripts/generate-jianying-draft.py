# -*- coding: utf-8 -*-
"""Generate JianYing draft project from editing V1 pipeline output.

Usage:
  python scripts/generate-jianying-draft.py <case_out_dir> [--target <drafts_dir>] [--asset-index <path>]
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
    VideoMaterial,
    TextSegment,
    TextStyle,
    ClipSettings,
    SEC,
)
import subprocess


def make_video_material(path: str, duration_us: int, width: int = 1080, height: int = 1920) -> VideoMaterial:
    """Manually construct a VideoMaterial, bypassing pymediainfo which fails on ProRes .mov."""
    import uuid, os
    mat = object.__new__(VideoMaterial)
    mat.material_id = uuid.uuid4().hex
    mat.local_material_id = ""
    mat.material_name = os.path.basename(path)
    mat.path = os.path.abspath(path)
    mat.duration = duration_us
    mat.width = width
    mat.height = height
    mat.material_type = "video"
    from pyJianYingDraft import CropSettings
    mat.crop_settings = CropSettings()
    return mat


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


def derive_draft_name(out_dir: Path) -> str:
    case_dir = out_dir.parent if out_dir.name == "out" else out_dir
    return f"{case_dir.name}_draft"


def main():
    if len(sys.argv) < 2:
        print("Usage: python scripts/generate-jianying-draft.py <case_out_dir> [--target <drafts_dir>]")
        sys.exit(1)

    out_dir = Path(sys.argv[1]).resolve()

    target_dir = None
    asset_index_path = None
    server_unc = os.environ.get("SERVER_UNC")
    for i, arg in enumerate(sys.argv):
        if arg == "--target" and i + 1 < len(sys.argv):
            target_dir = Path(sys.argv[i + 1])
        elif arg == "--asset-index" and i + 1 < len(sys.argv):
            asset_index_path = Path(sys.argv[i + 1])
        elif arg == "--server-unc" and i + 1 < len(sys.argv):
            server_unc = sys.argv[i + 1]

    source_video = out_dir / "source_direct_cut_video.mp4"
    overlay_video = out_dir / "overlay.mp4"
    progress_bar_video = out_dir / "overlay_progress_bar.mov"
    navigation_video = out_dir / "overlay_navigation.mov"
    scene_manifest = out_dir / "overlay_scenes" / "manifest.json"
    srt_file = out_dir / "subtitles.srt"
    timing_map_file = out_dir / "timing_map.json"

    for f in [source_video, srt_file, timing_map_file]:
        if not f.exists():
            print(f"Error: missing {f}")
            sys.exit(1)

    has_scene_clips = scene_manifest.exists()
    if not has_scene_clips and not overlay_video.exists():
        print(f"Error: missing both {scene_manifest} and {overlay_video}")
        sys.exit(1)

    timing_map = json.loads(timing_map_file.read_text(encoding="utf-8"))
    total_duration = timing_map.get("totalDuration", 0)
    # Use a slightly shorter duration to avoid exceeding actual media length
    total_us = int(total_duration * SEC) - 10000  # subtract 10ms safety margin

    draft_name = derive_draft_name(out_dir)
    draft_parent = target_dir if target_dir else out_dir
    draft_parent.mkdir(parents=True, exist_ok=True)

    print(f"Draft: {draft_name} ({total_duration:.1f}s)")

    folder = DraftFolder(str(draft_parent))
    script = folder.create_draft(draft_name, 1080, 1920, 30, allow_replace=True)

    # Track 1: main video
    script.add_track(TrackType.video, "main")
    script.add_segment(VideoSegment(
        str(source_video),
        target_timerange=Timerange(0, total_us),
    ), "main")

    # Track 2: overlay — per-scene clips if available, otherwise single file
    script.add_track(TrackType.video, "overlay", relative_index=1)

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
    else:
        script.add_segment(VideoSegment(
            str(overlay_video),
            target_timerange=Timerange(0, total_us),
        ), "overlay")
        print("  + overlay track (single file)")

    # Track 3: progress bar — single cropped mp4 strip, positioned at top
    pb_mp4 = out_dir / "overlay_progress_bar.mp4"
    if pb_mp4.exists():
        script.add_track(TrackType.video, "progress_bar", relative_index=2)
        # Canvas=1920, strip=100px. Center of strip at y=50px from top.
        # In half-canvas units: (50 - 960) / 960 = -0.948
        pb_position = ClipSettings(transform_y=-0.948)
        script.add_segment(VideoSegment(
            str(pb_mp4),
            target_timerange=Timerange(0, total_us),
            clip_settings=pb_position,
        ), "progress_bar")
        print("  + progress bar track (cropped strip)")

    # Track 4: navigation map — per-scene clips (.mp4) if available, otherwise single .mov file
    nav_manifest = out_dir / "nav_scenes" / "manifest.json"
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
        print(f"  + navigation track ({len(nav_clips)} scene clips)")
    elif navigation_video.exists():
        script.add_track(TrackType.video, "navigation", relative_index=3)
        mat = make_video_material(str(navigation_video), total_us)
        script.add_material(mat)
        script.add_segment(VideoSegment(
            mat,
            target_timerange=Timerange(0, total_us),
        ), "navigation")
        print("  + navigation track (single file)")

    # Track 5: asset clips (from blueprint asset_sub_scene + asset_index)
    blueprint_file = out_dir / "blueprint.json"
    if blueprint_file.exists() and asset_index_path and asset_index_path.exists():
        bp = json.loads(blueprint_file.read_text(encoding="utf-8"))
        asset_idx = json.loads(asset_index_path.read_text(encoding="utf-8"))
        asset_root = asset_idx.get("asset_root", "")

        # Build sub_scene -> asset file lookup (pick first match per sub_scene)
        sub_scene_to_asset = {}
        for asset in asset_idx.get("assets", []):
            for sc in asset.get("sub_scenes", []):
                if sc not in sub_scene_to_asset:
                    sub_scene_to_asset[sc] = asset

        # Build atom_id -> output time lookup from timing_map
        seg_map = {}
        for seg in timing_map.get("segments", []):
            seg_map[seg["atom_id"]] = seg["output"]

        # Find asset_clip segments and their time positions
        asset_clips = []
        for scene in bp.get("scenes", []):
            for ls in scene.get("logic_segments", []):
                sub_scene = ls.get("asset_sub_scene")
                if not sub_scene or ls.get("template") != "asset_clip":
                    continue
                asset = sub_scene_to_asset.get(sub_scene)
                if not asset:
                    continue
                # Get time range from keep atoms
                keep_atoms = [a for a in ls.get("atoms", []) if a.get("status") == "keep"]
                atom_ids = [a["id"] for a in keep_atoms]
                times = [seg_map[aid] for aid in atom_ids if aid in seg_map]
                if not times:
                    continue
                start_sec = min(t["start"] for t in times)
                end_sec = max(t["end"] for t in times)
                asset_path = os.path.join(asset_root, asset["file"])
                if not os.path.exists(asset_path):
                    continue
                asset_clips.append({
                    "path": asset_path,
                    "start": start_sec,
                    "end": end_sec,
                    "sub_scene": sub_scene,
                })

        if asset_clips:
            script.add_track(TrackType.video, "assets", relative_index=4)
            for ac in asset_clips:
                start_us = int(ac["start"] * SEC)
                dur_us = int((ac["end"] - ac["start"]) * SEC)
                if dur_us <= 0:
                    continue
                script.add_segment(VideoSegment(
                    ac["path"],
                    target_timerange=Timerange(start_us, dur_us),
                ), "assets")
            print(f"  + assets track ({len(asset_clips)} clips)")

    # Track 6: subtitles
    subs = parse_srt(str(srt_file))
    script.add_track(TrackType.text, "subs")

    style = TextStyle(size=8.0, color=(1.0, 1.0, 1.0))
    # Position at bottom 1/4: transform_y=0.5 means 0.5 * half-canvas = 480px below center
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

    # Rewrite local paths to UNC paths so editors can access files over network
    if server_unc:
        draft_folder = draft_parent / draft_name
        _rewrite_paths_to_unc(draft_folder, server_unc)

    print(f"  -> {draft_parent / draft_name}")


def _rewrite_paths_to_unc(draft_folder: Path, server_unc: str):
    """Replace local drive paths (D:\\...) with UNC paths (\\\\server\\share\\...)
    in all draft JSON files so JianYing on editors' computers can find the media."""

    # Collect local drive prefixes that appear in the draft
    # e.g. D:\AI editing\working files -> \\192.168.0.93\working files
    #      D:\AI editing\asset library -> \\192.168.0.93\asset library
    # Convention: D:\AI editing\<share_name>\... -> \\server\<share_name>\...
    #
    # We scan for all "D:\\" patterns and build replacements automatically.
    # The share name is the folder directly under the common root "AI editing".

    server_unc = server_unc.rstrip("\\")

    for fname in ["draft_content.json", "draft_content.json.bak", "template-2.tmp"]:
        fpath = draft_folder / fname
        if not fpath.exists():
            continue
        raw = fpath.read_bytes()

        # Find drive letter paths like X:\\AI editing\\ in the JSON bytes
        # Match pattern: single uppercase letter + :\ + \AI editing\ (with JSON escaping \\)
        for m in set(re.findall(rb'[A-Z]:\x5c\x5cAI editing\x5c\x5c([^\x5c"]+)\x5c\x5c', raw)):
            share_name = m  # e.g. b"working files" or b"asset library"
            old_prefix = re.escape(m)
            # D:\\AI editing\\working files\\ -> \\\\192.168.0.93\\working files\\
            pattern = rb'[A-Z]:\x5c\x5cAI editing\x5c\x5c' + old_prefix + rb'\x5c\x5c'
            replacement = server_unc.replace("\\", "\\\\").encode() + b"\x5c\x5c" + share_name + b"\x5c\x5c"
            raw = re.sub(pattern, replacement, raw)

        fpath.write_bytes(raw)

    count = 0
    try:
        import json as _json
        data = _json.loads((draft_folder / "draft_content.json").read_text(encoding="utf-8"))
        for m in data.get("materials", {}).get("videos", []):
            p = m.get("path", "")
            if server_unc.replace("\\\\", "\\") in p or server_unc in p:
                count += 1
    except Exception:
        pass
    if count:
        print(f"  + paths rewritten to UNC ({count} materials)")


if __name__ == "__main__":
    main()
