# -*- coding: utf-8 -*-
"""Generate JianYing draft with Nucleus asset clips (test for mengxiangen 02).

Hand-matched assets from ANH16180_About Your Heart Attack.mp4
with precise source_timerange based on ASR transcript timestamps.
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


ASSET_FILE = r"P:\团队空间\公司通用\AIkaifa\nucleus\cardiology\ANH16180_About Your Heart Attack.mp4"

# Hand-matched: LS output time -> asset source time
# Based on blueprint timing_map segments + ASR transcript alignment
MATCHES = [
    {
        "ls": "S4-L1",
        "desc": "心脏血管像供血水管 → coronary arteries supply heart muscle",
        "asset_source_start": 35.3,
        "asset_source_end": 54.6,
    },
    {
        "ls": "S4-L2",
        "desc": "血栓堵死冠状动脉 → plaque disrupted, blood clot, complete blockage",
        "asset_source_start": 71.4,
        "asset_source_end": 84.2,
    },
    {
        "ls": "S4-L3",
        "desc": "血流中断心肌缺氧坏死 → oxygen prevented, heart muscle started to die",
        "asset_source_start": 84.2,
        "asset_source_end": 103.2,
    },
    {
        "ls": "S5-L3",
        "desc": "看到血管哪里堵 → coronary angioplasty, balloon catheter",
        "asset_source_start": 119.7,
        "asset_source_end": 134.2,
    },
    {
        "ls": "S5-L4",
        "desc": "支架撑开血管 → stent, metal mesh scaffold",
        "asset_source_start": 134.2,
        "asset_source_end": 149.2,
    },
]


def main():
    out_dir = Path(r"P:\团队空间\公司通用\AIkaifa\AI total editing\260324\zhouqi\mengxiangen\02\out")
    target_dir = Path(r"\\DESKTOP-L8JBQB9\com.lveditor.draft")

    source_video = out_dir / "source_direct_cut_video.mp4"
    overlay_video = out_dir / "overlay.mp4"
    srt_file = out_dir / "subtitles.srt"
    timing_map_file = out_dir / "timing_map.json"
    blueprint_file = out_dir / "blueprint.json"

    timing_map = json.loads(timing_map_file.read_text(encoding="utf-8"))
    bp = json.loads(blueprint_file.read_text(encoding="utf-8"))
    total_duration = timing_map.get("totalDuration", 0)
    total_us = int(total_duration * SEC) - 10000

    # Build atom_id -> output time
    seg_map = {}
    for seg in timing_map.get("segments", []):
        seg_map[seg["atom_id"]] = seg["output"]

    # Build LS id -> output time range
    ls_times = {}
    for scene in bp.get("scenes", []):
        for ls in scene.get("logic_segments", []):
            keep_atoms = [a for a in ls.get("atoms", []) if a.get("status") == "keep"]
            times = [seg_map[a["id"]] for a in keep_atoms if a["id"] in seg_map]
            if times:
                ls_times[ls["id"]] = {
                    "start": min(t["start"] for t in times),
                    "end": max(t["end"] for t in times),
                }

    draft_name = "mengxiangen_nucleus_test"

    print(f"Draft: {draft_name} ({total_duration:.1f}s)")

    folder = DraftFolder(str(target_dir))
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
    script.add_segment(VideoSegment(
        str(overlay_video),
        target_timerange=Timerange(0, total_us),
    ), "overlay")
    print("  + overlay track")

    # Track 3: asset clips with source_timerange
    script.add_track(TrackType.video, "assets", relative_index=2)
    for match in MATCHES:
        ls_id = match["ls"]
        if ls_id not in ls_times:
            print(f"  [WARN] {ls_id} not found in timing")
            continue

        ls_time = ls_times[ls_id]
        target_start_us = int(ls_time["start"] * SEC)
        target_dur_us = int((ls_time["end"] - ls_time["start"]) * SEC)

        source_start_us = int(match["asset_source_start"] * SEC)
        source_dur_us = int((match["asset_source_end"] - match["asset_source_start"]) * SEC)

        script.add_segment(VideoSegment(
            ASSET_FILE,
            target_timerange=Timerange(target_start_us, target_dur_us),
            source_timerange=Timerange(source_start_us, source_dur_us),
        ), "assets")
        print(f"  + {match['ls']}: {ls_time['start']:.1f}-{ls_time['end']:.1f}s <- asset {match['asset_source_start']:.1f}-{match['asset_source_end']:.1f}s")
        print(f"    {match['desc']}")

    # Track 4: subtitles
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
    print(f"\n  -> {target_dir / draft_name}")


if __name__ == "__main__":
    main()
