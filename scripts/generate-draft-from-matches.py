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
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, r"F:/miniconda3/envs/agent/Lib/site-packages")

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

REPO_ROOT = Path(__file__).resolve().parent.parent
ASSET_ROOT = Path("P:/团队空间/公司通用/AIkaifa/nucleus/cardiology")
DEFAULT_ACCEPTED_MATCH_TYPES = {
    "same_visual_process",
    "same_visual_object",
    "direct_medical_action",
}


_MEDIA_DURATION_CACHE = {}


def load_env_file() -> None:
    env_path = REPO_ROOT / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def normalized_path_text(value: str) -> str:
    return str(value or "").replace("\\", "/").rstrip("/")


def rewrite_root(path_value: str, source_root: str, target_root: str) -> str:
    if not path_value or not source_root or not target_root:
        return path_value
    path_norm = normalized_path_text(path_value)
    source_norm = normalized_path_text(source_root)
    target_norm = normalized_path_text(target_root)
    path_lower = path_norm.lower()
    source_lower = source_norm.lower()
    if path_lower != source_lower and not path_lower.startswith(source_lower + "/"):
        return path_value
    suffix = path_norm[len(source_norm) :].lstrip("/")
    return f"{target_norm}/{suffix}" if suffix else target_norm


def join_under_root(root: str, path_value: str) -> str:
    root_norm = normalized_path_text(root)
    path_norm = normalized_path_text(path_value).lstrip("/")
    return f"{root_norm}/{path_norm}" if path_norm else root_norm


def to_draft_path(path: Path | str) -> str:
    value = str(path)
    mapped = rewrite_root(
        value,
        os.environ.get("DRAFT_PATH_SOURCE_ROOT", ""),
        os.environ.get("DRAFT_PATH_TARGET_ROOT", ""),
    )
    return mapped


def asset_source_value(picked: dict) -> str:
    mp4_path = picked.get("mp4_path")
    if mp4_path:
        return str(mp4_path)
    file_value = str(picked.get("file", ""))
    if Path(file_value).is_absolute():
        return file_value
    return join_under_root(str(ASSET_ROOT), file_value)


def map_asset_value_for_root(source_value: str, target_root: str) -> str:
    source_root = os.environ.get("ASSET_INDEX_SOURCE_ROOT", "")
    mapped = rewrite_root(source_value, source_root, target_root)
    if mapped != source_value:
        return mapped
    if target_root and not Path(source_value).is_absolute():
        return join_under_root(target_root, source_value)
    return mapped


def resolve_asset_paths(picked: dict) -> tuple[Path, str]:
    source_value = asset_source_value(picked)
    local_root = os.environ.get("ASSET_LOCAL_ROOT") or os.environ.get("ASSET_DRAFT_ROOT") or ""
    draft_root = os.environ.get("ASSET_DRAFT_ROOT") or local_root
    local_value = map_asset_value_for_root(source_value, local_root) if local_root else source_value
    draft_value = map_asset_value_for_root(source_value, draft_root) if draft_root else local_value
    return Path(local_value), draft_value


def probe_media_duration_us(path: Path) -> int | None:
    key = str(path)
    if key in _MEDIA_DURATION_CACHE:
        return _MEDIA_DURATION_CACHE[key]
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=20,
        )
        duration = float((result.stdout or "").strip())
        value = int(duration * SEC)
    except Exception:
        value = None
    _MEDIA_DURATION_CACHE[key] = value
    return value


def parse_csv_set(value: str | None, default: set[str]) -> set[str]:
    if not value:
        return set(default)
    return {item.strip() for item in value.split(",") if item.strip()}


def pick_matches_file(out_dir: Path, explicit_path: Path | None) -> Path:
    if explicit_path:
        return explicit_path
    candidates = [
        "asset_matches_atom_v3.json",
        "asset_matches_atom_v2.json",
        "asset_matches_atom.json",
        "asset_matches_v3.json",
        "asset_matches_v2.json",
        "asset_matches_atoms.json",
        "asset_matches.json",
    ]
    for name in candidates:
        path = out_dir / name
        if path.exists():
            return path
    return out_dir / candidates[0]


def should_accept_match(m: dict, picked: dict, min_fit_score: float, min_cosine: float, accepted_types: set[str]) -> tuple[bool, str]:
    if m.get("accepted") is False:
        return False, m.get("reject_reason") or "match rejected by matcher"
    if m.get("pick", 1) == 0:
        return False, "no pick"
    fit_score = m.get("fit_score")
    if fit_score is not None and float(fit_score) < min_fit_score:
        return False, f"fit_score {float(fit_score):.2f} < {min_fit_score:.2f}"
    match_type = m.get("match_type")
    if match_type and match_type not in accepted_types:
        return False, f"match_type {match_type} not accepted"
    cosine = picked.get("cosine")
    if cosine is not None and float(cosine) < min_cosine:
        return False, f"cosine {float(cosine):.2f} < {min_cosine:.2f}"
    return True, ""


def iter_match_records(matches: dict) -> list[dict]:
    if isinstance(matches.get("results"), list):
        return matches["results"]
    if isinstance(matches.get("matches"), list):
        return matches["matches"]
    return []


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
    load_env_file()

    if len(sys.argv) < 2:
        print("Usage: python scripts/generate-draft-from-matches.py <case_out_dir> [--target <drafts_dir>]")
        sys.exit(1)

    out_dir = Path(sys.argv[1]).resolve()

    target_dir = None
    explicit_matches_file = None
    draft_name_override = None
    min_fit_score = 0.75
    min_cosine = 0.0
    accepted_match_types = set(DEFAULT_ACCEPTED_MATCH_TYPES)
    max_exact_clip_reuse = 999
    max_asset_file_reuse = 999
    max_asset_basename_reuse = 999
    max_asset_speed = 999.0
    min_asset_speed = 0.0
    max_asset_source_duration = 0.0
    for i, arg in enumerate(sys.argv):
        if arg == "--target" and i + 1 < len(sys.argv):
            target_dir = Path(sys.argv[i + 1])
        elif arg == "--matches" and i + 1 < len(sys.argv):
            explicit_matches_file = Path(sys.argv[i + 1])
        elif arg == "--draft-name" and i + 1 < len(sys.argv):
            draft_name_override = sys.argv[i + 1]
        elif arg == "--min-fit-score" and i + 1 < len(sys.argv):
            min_fit_score = float(sys.argv[i + 1])
        elif arg == "--min-cosine" and i + 1 < len(sys.argv):
            min_cosine = float(sys.argv[i + 1])
        elif arg == "--accepted-match-types" and i + 1 < len(sys.argv):
            accepted_match_types = parse_csv_set(sys.argv[i + 1], DEFAULT_ACCEPTED_MATCH_TYPES)
        elif arg == "--max-exact-clip-reuse" and i + 1 < len(sys.argv):
            max_exact_clip_reuse = int(sys.argv[i + 1])
        elif arg == "--max-asset-file-reuse" and i + 1 < len(sys.argv):
            max_asset_file_reuse = int(sys.argv[i + 1])
        elif arg == "--max-asset-basename-reuse" and i + 1 < len(sys.argv):
            max_asset_basename_reuse = int(sys.argv[i + 1])
        elif arg == "--max-asset-speed" and i + 1 < len(sys.argv):
            max_asset_speed = float(sys.argv[i + 1])
        elif arg == "--min-asset-speed" and i + 1 < len(sys.argv):
            min_asset_speed = float(sys.argv[i + 1])
        elif arg == "--max-asset-source-duration" and i + 1 < len(sys.argv):
            max_asset_source_duration = float(sys.argv[i + 1])

    # Required files
    source_video = out_dir / "source_direct_cut_video.mp4"
    srt_file = out_dir / "subtitles.srt"
    timing_map_file = out_dir / "timing_map.json"
    blueprint_file = out_dir / "blueprint.json"
    matches_file = pick_matches_file(out_dir, explicit_matches_file)
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

    # Build asset clips from either match_blueprint_atom.py results or older category matches.
    asset_clips = []
    skipped_matches = []
    exact_clip_reuse = {}
    asset_file_reuse = {}
    asset_basename_reuse = {}
    for m in iter_match_records(matches):
        if "needs_animation" in m and not m.get("needs_animation"):
            continue

        picked = m.get("picked")
        if not picked:
            picked_segments = m.get("picked_segments", [])
            if picked_segments:
                picked = picked_segments[0]
            else:
                skipped_matches.append((m.get("seg_id", "?"), "no picked asset"))
                continue

        ok, reason = should_accept_match(
            m, picked, min_fit_score, min_cosine, accepted_match_types
        )
        if not ok:
            skipped_matches.append((m.get("seg_id", "?"), reason))
            continue

        seg_id = m["seg_id"]
        ls = seg_id_to_ls.get(seg_id)
        if not ls:
            skipped_matches.append((seg_id, "seg_id not found in blueprint"))
            continue

        start_sec, end_sec = get_logic_segment_time(ls, atom_times)
        if start_sec is None:
            skipped_matches.append((seg_id, "no timing"))
            continue
        if m.get("beat_index") is not None and m.get("beat_count"):
            beat_index = int(m.get("beat_index") or 1)
            beat_count = max(1, int(m.get("beat_count") or 1))
            beat_index = min(max(beat_index, 1), beat_count)
            logic_start_sec = start_sec
            logic_end_sec = end_sec
            logic_dur = max(0.01, logic_end_sec - logic_start_sec)
            start_sec = logic_start_sec + logic_dur * (beat_index - 1) / beat_count
            end_sec = logic_start_sec + logic_dur * beat_index / beat_count
        elif m.get("output_start") is not None and m.get("output_end") is not None:
            start_sec = float(m["output_start"])
            end_sec = float(m["output_end"])
            if end_sec <= start_sec:
                skipped_matches.append((seg_id, "invalid beat output timing"))
                continue

        asset_local_path, asset_draft_path = resolve_asset_paths(picked)
        if not asset_local_path.exists():
            print(f"  [WARN] asset not found: {asset_local_path}")
            skipped_matches.append((seg_id, f"asset not found: {asset_local_path}"))
            continue

        reuse_key = (
            str(asset_local_path).lower(),
            round(float(picked["start"]), 2),
            round(float(picked["end"]), 2),
        )
        file_reuse_key = str(asset_local_path).lower()
        basename_reuse_key = asset_local_path.name.lower()
        file_reuse_count = asset_file_reuse.get(file_reuse_key, 0)
        if file_reuse_count >= max_asset_file_reuse:
            skipped_matches.append((seg_id, f"asset file reused {file_reuse_count} times"))
            continue
        basename_reuse_count = asset_basename_reuse.get(basename_reuse_key, 0)
        if basename_reuse_count >= max_asset_basename_reuse:
            skipped_matches.append((seg_id, f"asset basename reused {basename_reuse_count} times"))
            continue
        reuse_count = exact_clip_reuse.get(reuse_key, 0)
        if reuse_count >= max_exact_clip_reuse:
            skipped_matches.append((seg_id, f"exact asset clip reused {reuse_count} times"))
            continue
        exact_clip_reuse[reuse_key] = reuse_count + 1
        asset_file_reuse[file_reuse_key] = file_reuse_count + 1
        asset_basename_reuse[basename_reuse_key] = basename_reuse_count + 1

        asset_clips.append({
            "seg_id": seg_id,
            "output_start": start_sec,
            "output_end": end_sec,
            "asset_local_path": str(asset_local_path),
            "asset_draft_path": asset_draft_path,
            "asset_start": picked["start"],
            "asset_end": picked["end"],
            "items": m.get("items", []),
            "fit_score": m.get("fit_score"),
            "match_type": m.get("match_type"),
            "relevance": m.get("rerank_reason") or picked.get("relevance", picked.get("reason", "")),
        })

    print(f"Blueprint: {bp['title']}")
    print(f"Duration: {total_duration:.1f}s")
    print(f"Matches: {matches_file}")
    print(f"Asset clips to place: {len(asset_clips)}")
    for ac in asset_clips:
        print(f"  {ac['seg_id']} [{ac['output_start']:.2f}-{ac['output_end']:.2f}s] → {Path(ac['asset_local_path']).name[:50]} [{ac['asset_start']:.1f}-{ac['asset_end']:.1f}s]")

    if skipped_matches:
        print(f"Skipped matches: {len(skipped_matches)}")
        for seg_id, reason in skipped_matches[:20]:
            print(f"  skip {seg_id}: {reason}")

    # Generate draft
    case_dir = out_dir.parent if out_dir.name == "out" else out_dir
    # Use timestamp suffix to avoid name collision with locked drafts
    import time as _time
    ts = _time.strftime("%m%d%H%M")
    draft_name = draft_name_override or f"{case_dir.name}_matched_{ts}"
    draft_parent = target_dir if target_dir else out_dir
    draft_parent.mkdir(parents=True, exist_ok=True)

    folder = DraftFolder(str(draft_parent))
    script = folder.create_draft(draft_name, 1080, 1920, 30, allow_replace=True)

    # Track 1: main video
    script.add_track(TrackType.video, "main")
    script.add_segment(VideoSegment(
        to_draft_path(source_video),
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
                to_draft_path(clip_path),
                target_timerange=Timerange(start_us, dur_us),
            ), "overlay")
            prev_end = start_us + dur_us
        print(f"  + overlay track ({len(scene_clips)} clips)")
    elif overlay_video.exists():
        script.add_segment(VideoSegment(
            to_draft_path(overlay_video),
            target_timerange=Timerange(0, total_us),
        ), "overlay")
        print("  + overlay track (single file)")

    # Track 3: progress bar
    if pb_mp4.exists():
        script.add_track(TrackType.video, "progress_bar", relative_index=2)
        pb_position = ClipSettings(transform_y=-0.948)
        script.add_segment(VideoSegment(
            to_draft_path(pb_mp4),
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
                to_draft_path(clip_path),
                target_timerange=Timerange(int(nc["start"] * SEC), dur_us),
            ), "navigation")
        print(f"  + navigation track ({len(nav_clips)} clips)")

    # Track 5: MATCHED ASSETS
    if asset_clips:
        script.add_track(TrackType.video, "assets", relative_index=4)
        for ac in asset_clips:
            output_start_us = int(ac["output_start"] * SEC)
            output_dur_us = int((ac["output_end"] - ac["output_start"]) * SEC)
            source_start_us = int(ac["asset_start"] * SEC)
            asset_avail_us = int((ac["asset_end"] - ac["asset_start"]) * SEC)
            source_dur_us = asset_avail_us
            # Safety margin: reduce by 100ms to avoid exceeding actual file duration
            source_dur_us = max(source_dur_us - 100000, SEC)
            media_duration_us = probe_media_duration_us(Path(ac["asset_local_path"]))
            media_end_us = media_duration_us - 100000 if media_duration_us else None
            if min_asset_speed > 0 and output_dur_us > 0:
                desired_source_dur_us = int(output_dur_us * min_asset_speed)
                if max_asset_source_duration > 0:
                    desired_source_dur_us = min(
                        desired_source_dur_us,
                        int(max_asset_source_duration * SEC),
                    )
                if desired_source_dur_us > source_dur_us:
                    extra_us = desired_source_dur_us - source_dur_us
                    before_us = int(extra_us * 0.35)
                    after_us = extra_us - before_us
                    new_start_us = max(0, source_start_us - before_us)
                    new_end_us = source_start_us + source_dur_us + after_us
                    if media_end_us is not None and new_end_us > media_end_us:
                        overflow_us = new_end_us - media_end_us
                        new_end_us = media_end_us
                        new_start_us = max(0, new_start_us - overflow_us)
                    source_start_us = new_start_us
                    source_dur_us = max(new_end_us - new_start_us, SEC)
            if max_asset_source_duration > 0:
                source_dur_us = min(source_dur_us, int(max_asset_source_duration * SEC))
            if media_end_us is not None and source_start_us + source_dur_us > media_end_us:
                source_dur_us = max(media_end_us - source_start_us, SEC)
            if max_asset_speed > 0 and output_dur_us > 0:
                max_source_dur_us = int(output_dur_us * max_asset_speed)
                if max_source_dur_us > 0 and source_dur_us > max_source_dur_us:
                    source_dur_us = max(max_source_dur_us, SEC)
            if source_dur_us <= 0 or output_dur_us <= 0:
                continue
            try:
                script.add_segment(VideoSegment(
                    ac["asset_draft_path"],
                    target_timerange=Timerange(output_start_us, output_dur_us),
                    source_timerange=Timerange(source_start_us, source_dur_us),
                ), "assets")
            except ValueError as e:
                print(f"  [WARN] Skipping {ac['seg_id']}: {e}")
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
