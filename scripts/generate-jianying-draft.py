# -*- coding: utf-8 -*-
"""Generate JianYing draft project from editing V1 pipeline output.

Usage:
  python scripts/generate-jianying-draft.py <case_out_dir> [--target <drafts_dir>]

Examples:
  # Output draft inside case out dir:
  python scripts/generate-jianying-draft.py "P:/.../xiehongrong/out"
  # -> P:/.../xiehongrong/out/xiehongrong_draft/

  # Output draft to a specific drafts folder:
  python scripts/generate-jianying-draft.py "P:/.../xiehongrong/out" --target "\\\\PC-WNJ\\jianying_drafts"
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


def derive_draft_name(out_dir: Path) -> str:
    """Derive a unique draft name from the case directory structure.

    Given: P:/.../260402/wangningjuan/xiehongrong/out
    Returns: "xiehongrong_draft"

    The parent of "out" is the case name.
    """
    # out_dir is typically ".../case_name/out", so case name is parent
    case_dir = out_dir.parent if out_dir.name == "out" else out_dir
    return f"{case_dir.name}_draft"


def main():
    if len(sys.argv) < 2:
        print("Usage: python scripts/generate-jianying-draft.py <case_out_dir> [--target <drafts_dir>]")
        sys.exit(1)

    out_dir = Path(sys.argv[1]).resolve()

    # Parse optional --target argument
    target_dir = None
    for i, arg in enumerate(sys.argv):
        if arg == "--target" and i + 1 < len(sys.argv):
            target_dir = Path(sys.argv[i + 1])
            break

    source_video = out_dir / "source_direct_cut_video.mp4"
    overlay_video = out_dir / "overlay.mp4"
    srt_file = out_dir / "subtitles.srt"
    timing_map_file = out_dir / "timing_map.json"

    for f in [source_video, overlay_video, srt_file, timing_map_file]:
        if not f.exists():
            print(f"Error: missing {f}")
            sys.exit(1)

    timing_map = json.loads(timing_map_file.read_text(encoding="utf-8"))
    total_duration = timing_map.get("totalDuration", 0)
    total_us = int(total_duration * SEC)

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

    # Track 2: overlay
    script.add_track(TrackType.video, "overlay", relative_index=1)
    script.add_segment(VideoSegment(
        str(overlay_video),
        target_timerange=Timerange(0, total_us),
    ), "overlay")

    # Track 3: subtitles
    subs = parse_srt(str(srt_file))
    script.add_track(TrackType.text, "subs")

    style = TextStyle(size=8.0, color=(1.0, 1.0, 1.0))
    for sub in subs:
        duration = sub["end"] - sub["start"]
        if duration <= 0.01:
            continue
        script.add_segment(TextSegment(
            sub["text"],
            timerange=Timerange(int(sub["start"] * SEC), int(duration * SEC)),
            style=style,
        ), "subs")

    script.save()
    print(f"  -> {draft_parent / draft_name}")


if __name__ == "__main__":
    main()
