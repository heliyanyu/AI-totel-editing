# -*- coding: utf-8 -*-
"""Split overlay and navigation videos into per-scene clips.

Usage:
  python scripts/split-overlay-by-scene.py <case_out_dir>

Outputs:
  <case_out_dir>/overlay_scenes/scene_XX_<title>.mp4 + manifest.json
  <case_out_dir>/nav_scenes/nav_XX_<title>.mov + manifest.json
"""

import json
import re
import subprocess
import sys
from pathlib import Path


def safe_filename(s: str, max_len: int = 30) -> str:
    # Remove Windows-illegal chars + Chinese punctuation that may cause issues
    s = re.sub(r'[\\/:*?"<>|：；，。、！？【】（）]', '', s)
    s = s.strip()
    return s[:max_len] if s else "untitled"


def build_segment_ranges(bp: dict, tm: dict) -> list:
    """Compute each logic_segment's output time range."""
    atom_seg = {}
    seg_meta = {}
    for scene in bp["scenes"]:
        for seg in scene.get("logic_segments", []):
            seg_meta[seg["id"]] = {"template": seg.get("template", ""), "scene_title": scene.get("title", "")}
            for atom in seg.get("atoms", []):
                if atom.get("status") == "keep":
                    atom_seg[atom["id"]] = seg["id"]

    seg_ranges = {}
    for s in tm["segments"]:
        sid = atom_seg.get(s["atom_id"])
        if not sid:
            continue
        if sid not in seg_ranges:
            seg_ranges[sid] = {"start": s["output"]["start"], "end": s["output"]["end"]}
        else:
            seg_ranges[sid]["start"] = min(seg_ranges[sid]["start"], s["output"]["start"])
            seg_ranges[sid]["end"] = max(seg_ranges[sid]["end"], s["output"]["end"])

    result = []
    for i, sid in enumerate(sorted(seg_ranges.keys())):
        r = seg_ranges[sid]
        meta = seg_meta.get(sid, {})
        result.append({
            "index": i,
            "id": sid,
            "title": f"{sid}_{meta.get('template', '')}",
            "start": r["start"],
            "end": r["end"],
        })
    return result


def build_scene_ranges(bp: dict, tm: dict) -> list:
    atom_scene = {}
    for si, scene in enumerate(bp["scenes"]):
        for seg in scene.get("logic_segments", []):
            for atom in seg.get("atoms", []):
                atom_scene[atom["id"]] = si

    scene_ranges = {}
    for clip in tm["clips"]:
        for aid in clip["atom_ids"]:
            si = atom_scene.get(aid)
            if si is None:
                continue
            if si not in scene_ranges:
                scene_ranges[si] = {"start": clip["output"]["start"], "end": clip["output"]["end"]}
            else:
                scene_ranges[si]["start"] = min(scene_ranges[si]["start"], clip["output"]["start"])
                scene_ranges[si]["end"] = max(scene_ranges[si]["end"], clip["output"]["end"])

    result = []
    for si in sorted(scene_ranges.keys()):
        r = scene_ranges[si]
        title = bp["scenes"][si].get("title", f"scene_{si}")
        result.append({
            "index": si,
            "title": title,
            "start": r["start"],
            "end": r["end"],
        })
    return result


def split_video(input_path: Path, output_dir: Path, entries: list, prefix: str,
                copy_codec: bool = True, force_ext: str = "",
                extra_args: list = None) -> list:
    """Split a video into clips. Returns manifest entries."""
    output_dir.mkdir(exist_ok=True)
    manifest = []

    for entry in entries:
        si = entry["index"]
        title = safe_filename(entry["title"])
        ext = force_ext if force_ext else input_path.suffix
        filename = f"{prefix}_{si:02d}_{title}{ext}"
        output_path = output_dir / filename

        start = entry["start"]
        duration = entry["duration"]

        if duration <= 0.01:
            continue

        cmd = [
            "ffmpeg", "-y",
            "-ss", f"{start:.3f}",
            "-i", str(input_path),
            "-t", f"{duration:.3f}",
        ]
        if copy_codec:
            cmd += ["-c", "copy"]
        else:
            # Re-encode to standard yuv420p for compatibility
            cmd += ["-pix_fmt", "yuv420p"]
        if extra_args:
            cmd += extra_args
        cmd += ["-an", str(output_path)]

        subprocess.run(cmd, check=True, capture_output=True)

        manifest.append({
            "scene_index": si,
            "title": entry["title"],
            "filename": filename,
            "start": round(start, 3),
            "end": round(start + duration, 3),
            "duration": round(duration, 3),
        })
        print(f"  {prefix} {si:2d}: {duration:6.1f}s  {filename}")

    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


NAV_DISPLAY_SEC = 2.5


def main():
    if len(sys.argv) < 2:
        print("Usage: python scripts/split-overlay-by-scene.py <case_out_dir>")
        sys.exit(1)

    out_dir = Path(sys.argv[1]).resolve()
    overlay = out_dir / "overlay.mp4"
    nav_video = out_dir / "overlay_navigation.mp4"
    if not nav_video.exists():
        nav_video = out_dir / "overlay_navigation.mov"  # legacy fallback
    pb_video = out_dir / "overlay_progress_bar.mp4"
    if not pb_video.exists():
        pb_video = out_dir / "overlay_progress_bar.mov"  # legacy fallback
    bp_file = out_dir / "blueprint.json"
    tm_file = out_dir / "timing_map.json"

    for f in [bp_file, tm_file]:
        if not f.exists():
            print(f"Error: missing {f}")
            sys.exit(1)

    bp = json.loads(bp_file.read_text(encoding="utf-8"))
    tm = json.loads(tm_file.read_text(encoding="utf-8"))
    scenes = build_scene_ranges(bp, tm)
    segments = build_segment_ranges(bp, tm)

    scene_entries = [
        {**s, "duration": s["end"] - s["start"]}
        for s in scenes
    ]
    # Extend each segment to the next segment's start (no gaps)
    segment_entries = []
    for i, s in enumerate(segments):
        next_start = segments[i + 1]["start"] if i + 1 < len(segments) else tm.get("totalDuration", s["end"])
        segment_entries.append({**s, "duration": next_start - s["start"]})

    # Split overlay into per-segment clips (one per template)
    if overlay.exists():
        overlay_manifest = split_video(
            overlay, out_dir / "overlay_scenes", segment_entries, "seg"
        )
        print(f"\n{len(overlay_manifest)} overlay clips (per segment, no gaps)")
    else:
        print("  overlay.mp4 not found, skipping overlay split")

    # Crop progress bar to top 100px strip
    if pb_video.exists():
        pb_cropped = out_dir / "overlay_progress_bar_cropped.mp4"
        subprocess.run([
            "ffmpeg", "-y",
            "-i", str(pb_video),
            "-vf", "crop=1080:100:0:50",
            "-pix_fmt", "yuv420p",
            "-an", str(pb_cropped),
        ], check=True, capture_output=True)
        # Replace original with cropped version
        pb_cropped.replace(pb_video)
        print(f"\n  progress bar: {pb_video.name} (cropped to 1080x100)")
    else:
        print("  overlay_progress_bar.mov not found, skipping")

    # Split navigation into per-scene clips (only the display window)
    if nav_video.exists():
        nav_entries = [
            {**s, "duration": min(NAV_DISPLAY_SEC, s["end"] - s["start"])}
            for s in scenes
        ]
        nav_manifest = split_video(
            nav_video, out_dir / "nav_scenes", nav_entries, "nav",
            copy_codec=False, force_ext=".mp4",
        )
        print(f"\n{len(nav_manifest)} navigation clips")
    else:
        print("  overlay_navigation.mov not found, skipping nav split")


if __name__ == "__main__":
    main()
