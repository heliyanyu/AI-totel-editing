# -*- coding: utf-8 -*-
"""Create visual beats from blueprint logic segments and cached visual needs."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

sys.stdout.reconfigure(encoding="utf-8")


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bp", required=True)
    ap.add_argument("--timing-map")
    ap.add_argument("--visual-needs", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--max-beats-per-seg", type=int, default=3)
    ap.add_argument("--min-sec-per-beat", type=float, default=2.4)
    return ap.parse_args()


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def clean_text(value: Any, limit: int = 800) -> str:
    text = str(value or "").replace("\r", " ").replace("\n", " ").strip()
    text = re.sub(r"\s+", " ", text)
    if len(text) > limit:
        return text[: limit - 1] + "…"
    return text


def atom_text(atom: dict) -> str:
    return str(atom.get("subtitle_text") or atom.get("text") or "")


def atom_is_keep(atom: dict) -> bool:
    return atom.get("status", "keep") == "keep"


def atom_time(atom: dict, key: str) -> float:
    time_data = atom.get("time") or {}
    if isinstance(time_data, dict) and key in time_data:
        return float(time_data[key])
    fallback = "start_ms" if key == "start" else "end_ms"
    if fallback in atom:
        return float(atom[fallback]) / 1000.0
    return 0.0


def build_atom_output_times(timing_map_path: Path | None) -> dict[int, dict]:
    if not timing_map_path:
        return {}
    timing_map = read_json(timing_map_path)
    out = {}
    for segment in timing_map.get("segments", []):
        atom_id = segment.get("atom_id")
        output = segment.get("output")
        if atom_id is not None and isinstance(output, dict):
            out[int(atom_id)] = output
    return out


def load_blueprint_segments(path: Path, atom_output_times: dict[int, dict] | None = None) -> tuple[list[dict], str, int]:
    bp = read_json(path)
    title = bp.get("title", "")
    flat = []
    atom_output_times = atom_output_times or {}
    for scene in bp.get("scenes", []):
        for logic_segment in scene.get("logic_segments", []):
            atoms = [a for a in logic_segment.get("atoms", []) if atom_is_keep(a)]
            if not atoms:
                atoms = logic_segment.get("atoms", [])
            if not atoms:
                continue
            output_times = [
                atom_output_times[a["id"]]
                for a in atoms
                if a.get("id") in atom_output_times
            ]
            if output_times:
                time_start = min(float(t["start"]) for t in output_times)
                time_end = max(float(t["end"]) for t in output_times)
            else:
                time_start = atom_time(atoms[0], "start")
                time_end = atom_time(atoms[-1], "end")
            flat.append(
                {
                    "seg_id": logic_segment.get("id"),
                    "bp_title": title,
                    "scene_id": scene.get("id", ""),
                    "scene_title": scene.get("title", ""),
                    "template": logic_segment.get("template"),
                    "items": [str(it.get("text", "")) for it in logic_segment.get("items", [])],
                    "atoms_text": "".join(atom_text(a) for a in atoms),
                    "time_start": time_start,
                    "time_end": time_end,
                }
            )
    return flat, title, len(bp.get("scenes", []))


def split_visual_clauses(visual: str, max_beats: int) -> list[str]:
    visual = clean_text(visual, 1200)
    visual = re.sub(r"(\d)\.(\d)", r"\1<DOT>\2", visual)
    raw_parts = [p.strip().replace("<DOT>", ".") for p in re.split(r"[，,；;。!！]", visual) if p.strip()]
    parts = []
    pending = ""
    for part in raw_parts:
        if pending:
            part = pending + "，" + part
            pending = ""
        if (
            len(part) <= 12
            and (
                part.endswith(("中", "内", "里", "下"))
                or any(token in part for token in ["横截面", "纵切面", "截面", "特写", "界面"])
            )
        ):
            pending = part
            continue
        parts.append(part)
    if pending:
        parts.append(pending)
    parts = [p for p in parts if len(p) >= 4]
    if not parts:
        return [visual] if visual else []
    if len(parts) <= max_beats:
        return parts
    priority_keywords = [
        "破裂",
        "撕裂",
        "裂口",
        "血栓",
        "堵塞",
        "狭窄",
        "纤维帽",
        "胆固醇",
        "LDL",
        "沉积",
        "堆积",
        "形成",
        "钙化",
        "缩小",
        "降低",
        "减少",
        "飙升",
        "冲击",
        "漂浮",
        "覆盖",
        "包裹",
        "穿透",
        "穿入",
    ]

    def score(item: tuple[int, str]) -> float:
        _, part = item
        return sum(1 for kw in priority_keywords if kw.lower() in part.lower()) + min(len(part), 80) / 200.0

    indexed = list(enumerate(parts))
    chosen_idx = {idx for idx, _ in sorted(indexed, key=score, reverse=True)[:max_beats]}
    return [part for idx, part in indexed if idx in chosen_idx]


def distribute_terms(terms: list[str], clause: str) -> list[str]:
    clause_l = clause.lower()
    matched = []
    for term in terms:
        t = clean_text(term, 80)
        if not t:
            continue
        if t.lower() in clause_l:
            matched.append(t)
    return matched


def make_beat(seg: dict, need: dict, clause: str, index: int, count: int) -> dict:
    subjects = [clean_text(x, 80) for x in need.get("subjects", []) if clean_text(x, 80)]
    actions = [clean_text(x, 80) for x in need.get("actions", []) if clean_text(x, 80)]
    matched_subjects = distribute_terms(subjects, clause) or subjects[:4]
    matched_actions = distribute_terms(actions, clause) or actions[:4]
    role = "primary" if index == 1 else "secondary"
    if count == 1:
        role = "primary"
    return {
        "beat_id": f"{seg['seg_id']}-B{index}",
        "seg_id": seg["seg_id"],
        "beat_index": index,
        "beat_count": count,
        "role": role,
        "needs_animation": True,
        "scene_type": need.get("scene_type") or "",
        "doctor_text": clean_text(seg.get("atoms_text"), 700),
        "visual": clause,
        "subjects": matched_subjects,
        "actions": matched_actions,
        "must_have": matched_subjects[:3] + matched_actions[:2],
        "avoid": [clean_text(x, 100) for x in need.get("negative", [])],
        "source_visual_need": clean_text(need.get("visual"), 1000),
        "reason": clean_text(need.get("reason"), 400),
        "time_start": seg.get("time_start"),
        "time_end": seg.get("time_end"),
        "bp_title": seg.get("bp_title"),
        "scene_id": seg.get("scene_id"),
        "scene_title": seg.get("scene_title"),
        "template": seg.get("template"),
        "items": seg.get("items", []),
    }


def main() -> None:
    args = parse_args()
    atom_output_times = build_atom_output_times(Path(args.timing_map)) if args.timing_map else {}
    segs, title, n_scenes = load_blueprint_segments(Path(args.bp), atom_output_times)
    needs_data = read_json(Path(args.visual_needs))
    needs = needs_data.get("visual_needs", needs_data) if isinstance(needs_data, dict) else needs_data
    need_by_id = {str(n.get("seg_id")): n for n in needs}
    beats = []
    no_animation = []
    for seg in segs:
        need = need_by_id.get(str(seg["seg_id"]), {})
        if not need.get("needs_animation"):
            no_animation.append(
                {
                    "seg_id": seg["seg_id"],
                    "needs_animation": False,
                    "reason": clean_text(need.get("reason")),
                    "doctor_text": clean_text(seg.get("atoms_text"), 500),
                }
            )
            continue
        duration = max(0.01, float(seg.get("time_end") or 0.0) - float(seg.get("time_start") or 0.0))
        time_limited_max = max(1, int(duration // args.min_sec_per_beat))
        max_beats = min(args.max_beats_per_seg, time_limited_max)
        if max_beats == 1:
            clauses = [clean_text(need.get("visual"), 1000)]
        else:
            clauses = split_visual_clauses(need.get("visual") or "", max_beats)
        if not clauses:
            continue
        for i, clause in enumerate(clauses, 1):
            beats.append(make_beat(seg, need, clause, i, len(clauses)))

    data = {
        "bp_title": title,
        "n_scenes": n_scenes,
        "n_logic_segments": len(segs),
        "n_visual_segments": sum(1 for n in need_by_id.values() if n.get("needs_animation")),
        "n_visual_beats": len(beats),
        "method": "heuristic-split-from-visual-needs-v1",
        "visual_beats": beats,
        "no_animation": no_animation,
    }
    write_json(Path(args.out), data)
    print(f"Saved visual beats: {args.out}")
    print(f"Visual beats: {len(beats)} from {data['n_visual_segments']} visual logic segments")
    for beat in beats[:20]:
        print(f"  {beat['beat_id']}: {beat['visual']}")


if __name__ == "__main__":
    main()
