# -*- coding: utf-8 -*-
"""Generate JianYing draft with an additional asset track.

Wraps generate-jianying-draft logic and adds a track for matched assets.

Usage:
  python scripts/generate-draft-with-assets.py <case_out_dir>
"""

import json
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


# Asset matches for mengxiangen 02 (心梗黄金12小时)
# (output_start_sec, output_end_sec, asset_file_path)
ASSET_MATCHES = [
    (65.10, 68.14,
     r"F:\AI total editing\editing V1\2 循环系统疾病\10 主动脉和周围血管疾病\冠状动脉疾病.mp4"),
    (68.46, 71.42,
     r"F:\AI total editing\editing V1\2 循环系统疾病\10 主动脉和周围血管疾病\血栓形成.mp4"),
    (71.50, 76.70,
     r"F:\AI total editing\editing V1\2 循环系统疾病\5 心肌疾病\心肌梗塞.mp4"),
    (77.02, 85.02,
     r"F:\AI total editing\editing V1\2 循环系统疾病\1 心力衰竭\心肌梗死-1.mp4"),
    (97.60, 101.12,
     r"F:\AI total editing\editing V1\2 循环系统疾病\1 心力衰竭\心脏造影-1.mp4"),
    (101.36, 105.20,
     r"F:\AI total editing\editing V1\2 循环系统疾病\3 动脉粥样硬化和冠状动脉粥样硬化性心脏病\球囊以及支架-1.mp4"),
]


def main():
    out_dir = Path(sys.argv[1]).resolve()

    source_video = out_dir / "source_direct_cut_video.mp4"
    overlay_video = out_dir / "overlay.mp4"
    scene_manifest = out_dir / "overlay_scenes" / "manifest.json"
    srt_file = out_dir / "subtitles.srt"
    timing_map_file = out_dir / "timing_map.json"
    pb_mp4 = out_dir / "overlay_progress_bar.mp4"
    nav_manifest = out_dir / "nav_scenes" / "manifest.json"

    for f in [source_video, srt_file, timing_map_file]:
        if not f.exists():
            print(f"Error: missing {f}")
            sys.exit(1)

    timing_map = json.loads(timing_map_file.read_text(encoding="utf-8"))
    total_duration = timing_map.get("totalDuration", 0)
    total_us = int(total_duration * SEC) - 10000

    case_dir = out_dir.parent if out_dir.name == "out" else out_dir
    draft_name = f"{case_dir.name}_draft_with_assets"

    print(f"Draft: {draft_name} ({total_duration:.1f}s)")

    folder = DraftFolder(str(out_dir))
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

    # Track 5: ASSET CLIPS — the new track
    script.add_track(TrackType.video, "assets", relative_index=4)
    asset_count = 0
    for start_sec, end_sec, asset_path in ASSET_MATCHES:
        if not Path(asset_path).exists():
            print(f"  [WARN] asset not found: {asset_path}")
            continue
        start_us = int(start_sec * SEC)
        dur_us = int((end_sec - start_sec) * SEC)
        if dur_us <= 0:
            continue
        script.add_segment(VideoSegment(
            asset_path,
            target_timerange=Timerange(start_us, dur_us),
        ), "assets")
        asset_count += 1
    print(f"  + assets track ({asset_count} clips)")

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
    print(f"  -> {out_dir / draft_name}")


if __name__ == "__main__":
    main()
