# -*- coding: utf-8 -*-
"""Diff two JianYing 5.9 draft_content.json files.

Compares the original (AI-generated) draft against the editor-modified draft,
and outputs all meaningful changes on the asset/overlay tracks.

Usage:
  python scripts/diff-draft.py <original_draft_content.json> <edited_draft_content.json>
"""

import json
import os
import sys


def load_draft(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def build_material_map(draft):
    """Map material_id -> {path, name, has_audio, ...}"""
    mat_map = {}
    for v in draft.get("materials", {}).get("videos", []):
        mat_map[v["id"]] = {
            "path": v.get("path", ""),
            "name": os.path.basename(v.get("path", "")),
            "duration": v.get("duration", 0),
            "has_audio": v.get("has_audio"),
        }
    return mat_map


def extract_video_tracks(draft):
    """Extract video tracks with segment details."""
    mat_map = build_material_map(draft)
    tracks = []
    for t in draft.get("tracks", []):
        if t.get("type") != "video":
            continue
        segments = []
        for seg in t.get("segments", []):
            mat_id = seg.get("material_id", "")
            mat = mat_map.get(mat_id, {})
            tr = seg.get("target_timerange", {})
            sr = seg.get("source_timerange", {})
            segments.append({
                "material_id": mat_id,
                "name": mat.get("name", "?"),
                "path": mat.get("path", ""),
                "start": tr.get("start", 0),
                "duration": tr.get("duration", 0),
                "source_start": sr.get("start", 0),
                "source_duration": sr.get("duration", 0),
                "extra_refs": seg.get("extra_material_refs", []),
            })
        tracks.append(segments)
    return tracks


def us_to_sec(us):
    return round(us / 1_000_000, 2)


def diff_drafts(orig_path, edited_path):
    orig = load_draft(orig_path)
    edited = load_draft(edited_path)

    orig_tracks = extract_video_tracks(orig)
    edit_tracks = extract_video_tracks(edited)

    changes = []

    # --- Track count change ---
    if len(orig_tracks) != len(edit_tracks):
        changes.append({
            "type": "track_count_change",
            "detail": f"视频轨道数 {len(orig_tracks)} → {len(edit_tracks)}",
        })

    # --- Per-track comparison ---
    for ti in range(max(len(orig_tracks), len(edit_tracks))):
        o_segs = orig_tracks[ti] if ti < len(orig_tracks) else []
        e_segs = edit_tracks[ti] if ti < len(edit_tracks) else []

        track_label = f"Track{ti}"

        # Build lookup by material path + approximate time
        o_by_path = {}
        for s in o_segs:
            key = s["path"]
            o_by_path.setdefault(key, []).append(s)

        e_by_path = {}
        for s in e_segs:
            key = s["path"]
            e_by_path.setdefault(key, []).append(s)

        o_paths = set(o_by_path.keys())
        e_paths = set(e_by_path.keys())

        # Deleted segments
        for path in o_paths - e_paths:
            for s in o_by_path[path]:
                changes.append({
                    "type": "asset_removed",
                    "track": track_label,
                    "name": s["name"],
                    "path": s["path"],
                    "start": us_to_sec(s["start"]),
                    "duration": us_to_sec(s["duration"]),
                })

        # Added segments
        for path in e_paths - o_paths:
            for s in e_by_path[path]:
                changes.append({
                    "type": "asset_added",
                    "track": track_label,
                    "name": s["name"],
                    "path": s["path"],
                    "start": us_to_sec(s["start"]),
                    "duration": us_to_sec(s["duration"]),
                })

        # Modified segments (same path, check time/duration changes)
        for path in o_paths & e_paths:
            o_list = o_by_path[path]
            e_list = e_by_path[path]

            # Simple case: same count, compare pairwise
            for i in range(max(len(o_list), len(e_list))):
                if i >= len(o_list):
                    s = e_list[i]
                    changes.append({
                        "type": "asset_added",
                        "track": track_label,
                        "name": s["name"],
                        "start": us_to_sec(s["start"]),
                        "duration": us_to_sec(s["duration"]),
                    })
                elif i >= len(e_list):
                    s = o_list[i]
                    changes.append({
                        "type": "asset_removed",
                        "track": track_label,
                        "name": s["name"],
                        "start": us_to_sec(s["start"]),
                        "duration": us_to_sec(s["duration"]),
                    })
                else:
                    o_s = o_list[i]
                    e_s = e_list[i]
                    name = o_s["name"]

                    # Time position change
                    if abs(o_s["start"] - e_s["start"]) > 100_000:  # >0.1s
                        changes.append({
                            "type": "time_moved",
                            "track": track_label,
                            "name": name,
                            "original_start": us_to_sec(o_s["start"]),
                            "new_start": us_to_sec(e_s["start"]),
                        })

                    # Duration change
                    if abs(o_s["duration"] - e_s["duration"]) > 100_000:  # >0.1s
                        changes.append({
                            "type": "duration_changed",
                            "track": track_label,
                            "name": name,
                            "original_duration": us_to_sec(o_s["duration"]),
                            "new_duration": us_to_sec(e_s["duration"]),
                        })

                    # Source trim change (editor trimmed the clip)
                    if abs(o_s["source_start"] - e_s["source_start"]) > 100_000:
                        changes.append({
                            "type": "source_trimmed",
                            "track": track_label,
                            "name": name,
                            "original_source_start": us_to_sec(o_s["source_start"]),
                            "new_source_start": us_to_sec(e_s["source_start"]),
                        })

    # --- Audio changes ---
    o_vocal = orig.get("materials", {}).get("vocal_separations", [])
    e_vocal = edited.get("materials", {}).get("vocal_separations", [])
    if len(e_vocal) > len(o_vocal):
        changes.append({
            "type": "audio_removed",
            "detail": f"音频被删除/静音：{len(e_vocal) - len(o_vocal)} 个素材",
        })

    o_scm = orig.get("materials", {}).get("sound_channel_mappings", [])
    e_scm = edited.get("materials", {}).get("sound_channel_mappings", [])
    if len(e_scm) > len(o_scm):
        changes.append({
            "type": "audio_channel_changed",
            "detail": f"音频通道映射变更：{len(o_scm)} → {len(e_scm)}",
        })

    return changes


def main():
    if len(sys.argv) < 3:
        print("Usage: python scripts/diff-draft.py <original.json> <edited.json>")
        sys.exit(1)

    orig_path = sys.argv[1]
    edited_path = sys.argv[2]

    changes = diff_drafts(orig_path, edited_path)

    if not changes:
        print("无变动。")
        return

    print(f"共检测到 {len(changes)} 项变动：\n")
    for c in changes:
        t = c["type"]
        if t == "asset_removed":
            print(f"  ❌ 删除素材: {c['name']} (原位置 {c['start']}s, 时长 {c['duration']}s)")
        elif t == "asset_added":
            print(f"  ✅ 新增素材: {c['name']} (位置 {c['start']}s, 时长 {c['duration']}s)")
        elif t == "time_moved":
            print(f"  ⏩ 位置调整: {c['name']} ({c['original_start']}s → {c['new_start']}s)")
        elif t == "duration_changed":
            print(f"  ⏱️  时长调整: {c['name']} ({c['original_duration']}s → {c['new_duration']}s)")
        elif t == "source_trimmed":
            print(f"  ✂️  裁剪调整: {c['name']} (源起点 {c['original_source_start']}s → {c['new_source_start']}s)")
        elif t == "audio_removed":
            print(f"  🔇 {c['detail']}")
        elif t == "audio_channel_changed":
            print(f"  🔊 {c['detail']}")
        elif t == "track_count_change":
            print(f"  📊 {c['detail']}")
        else:
            print(f"  ℹ️  {t}: {c}")

    # Also output as JSON for programmatic use
    out_path = os.path.splitext(edited_path)[0] + ".diff.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(changes, f, ensure_ascii=False, indent=2)
    print(f"\n变动记录已保存: {out_path}")


if __name__ == "__main__":
    main()
