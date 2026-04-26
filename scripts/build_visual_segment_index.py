# -*- coding: utf-8 -*-
"""Build an index of variable-length visual segments from visual atoms."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Any

import numpy as np

sys.stdout.reconfigure(encoding="utf-8")

REPO_ROOT = Path(__file__).resolve().parent.parent
EMBED_MODEL = "text-embedding-v4"
EMBED_DIM = 1024


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser()
    ap.add_argument("--visual-atoms", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--emb")
    ap.add_argument("--keys")
    ap.add_argument("--stage", choices=["build", "embed", "all"], default="all")
    ap.add_argument("--min-dur", type=float, default=3.0)
    ap.add_argument("--max-dur", type=float, default=12.0)
    ap.add_argument("--max-gap", type=float, default=2.5)
    ap.add_argument("--min-confidence", type=float, default=0.35)
    ap.add_argument("--min-window-confidence", type=float, default=0.45)
    ap.add_argument("--max-windows-per-start", type=int, default=4)
    ap.add_argument("--embed-batch-size", type=int, default=10)
    return ap.parse_args()


def load_jsonl(path: Path) -> list[dict]:
    rows = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def clean_text(value: Any, limit: int = 2000) -> str:
    text = str(value or "").replace("\r", " ").replace("\n", " ").strip()
    while "  " in text:
        text = text.replace("  ", " ")
    if len(text) > limit:
        return text[: limit - 1] + "…"
    return text


def confidence(row: dict) -> float:
    try:
        return float(row.get("visual_confidence") or 0.0)
    except (TypeError, ValueError):
        return 0.0


def subject_items(row: dict) -> list[str]:
    vals = []
    for item in row.get("primary_subjects", []) + row.get("secondary_subjects", []):
        if isinstance(item, dict) and item.get("subject"):
            vals.append(str(item["subject"]))
    return vals


def action_items(row: dict) -> list[str]:
    vals = []
    for item in row.get("visible_actions", []):
        if isinstance(item, dict) and item.get("action"):
            vals.append(
                " ".join(
                    str(x).strip()
                    for x in [item.get("actor"), item.get("action"), item.get("target")]
                    if str(x or "").strip()
                )
            )
    return vals


def ordered_unique(values: list[str], limit: int = 12) -> list[str]:
    seen = set()
    out = []
    for value in values:
        value = clean_text(value, 120)
        key = value.lower()
        if not value or key in seen:
            continue
        seen.add(key)
        out.append(value)
        if len(out) >= limit:
            break
    return out


def segment_id(file_key: str, start: float, end: float, atom_ids: list[int]) -> str:
    raw = f"{file_key}|{start:.3f}|{end:.3f}|{','.join(str(x) for x in atom_ids)}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def make_segment(file_key: str, rows: list[dict]) -> dict:
    start = float(rows[0].get("start") or 0.0)
    end = float(rows[-1].get("end") or start)
    atom_ids = [int(r["atom_id"]) for r in rows]
    subjects = ordered_unique([item for row in rows for item in subject_items(row)], 14)
    actions = ordered_unique([item for row in rows for item in action_items(row)], 14)
    visuals = [clean_text(r.get("visual_one_line"), 260) for r in rows if clean_text(r.get("visual_one_line"), 260)]
    narrations = [clean_text(r.get("narration_text"), 260) for r in rows if clean_text(r.get("narration_text"), 260)]
    confs = [confidence(r) for r in rows]
    visual = " | ".join(ordered_unique(visuals, 8))
    search_text = "\n".join(
        [
            f"visual: {visual}",
            "subjects: " + " ".join(subjects),
            "actions: " + " ".join(actions),
            "narration: " + " ".join(narrations[:5]),
        ]
    )
    scene_types = ordered_unique([str(r.get("visual_scene_type") or "") for r in rows], 5)
    return {
        "segment_id": segment_id(file_key, start, end, atom_ids),
        "file_key": file_key,
        "file": rows[0].get("file"),
        "mp4_path": rows[0].get("mp4_path"),
        "lang": rows[0].get("lang"),
        "start": round(start, 3),
        "end": round(end, 3),
        "duration": round(max(0.0, end - start), 3),
        "source_atom_ids": atom_ids,
        "visual": visual,
        "visual_one_line": visual,
        "visual_scene_type": " / ".join(scene_types),
        "subjects": " / ".join(subjects),
        "actions": " / ".join(actions),
        "narration_text": " ".join(narrations),
        "visual_confidence": round(max(confs) if confs else 0.0, 3),
        "mean_visual_confidence": round(sum(confs) / len(confs), 3) if confs else 0.0,
        "visual_search_text": search_text,
    }


def build_segments(args: argparse.Namespace) -> list[dict]:
    atoms = load_jsonl(Path(args.visual_atoms))
    groups: dict[str, list[dict]] = {}
    for row in atoms:
        file_key = str(row.get("file_key") or row.get("file") or "")
        if not file_key:
            continue
        groups.setdefault(file_key, []).append(row)
    for rows in groups.values():
        rows.sort(key=lambda r: float(r.get("start") or 0.0))

    dedup: dict[tuple[str, float, float], dict] = {}
    for file_key, rows in groups.items():
        n = len(rows)
        for i in range(n):
            start = float(rows[i].get("start") or 0.0)
            end = float(rows[i].get("end") or start)
            window_rows = [rows[i]]
            windows_added = 0
            j = i
            while j < n:
                if j > i:
                    prev_end = float(rows[j - 1].get("end") or end)
                    cur_start = float(rows[j].get("start") or prev_end)
                    cur_end = float(rows[j].get("end") or cur_start)
                    if cur_start - prev_end > args.max_gap:
                        break
                    if cur_end - start > args.max_dur:
                        break
                    window_rows.append(rows[j])
                    end = cur_end
                duration = end - start
                confs = [confidence(r) for r in window_rows]
                if (
                    duration >= args.min_dur
                    and max(confs or [0.0]) >= args.min_confidence
                    and (sum(confs) / len(confs)) >= args.min_window_confidence
                ):
                    segment = make_segment(file_key, list(window_rows))
                    key = (file_key, segment["start"], segment["end"])
                    existing = dedup.get(key)
                    if existing is None or segment["visual_confidence"] > existing["visual_confidence"]:
                        dedup[key] = segment
                    windows_added += 1
                    if windows_added >= args.max_windows_per_start:
                        break
                j += 1
    segments = sorted(dedup.values(), key=lambda r: (str(r.get("file") or ""), float(r["start"]), float(r["end"])))
    return segments


def embed_texts(texts: list[str], batch_size: int) -> np.ndarray:
    from dotenv import load_dotenv
    from openai import OpenAI

    load_dotenv(dotenv_path=str(REPO_ROOT / ".env"))
    client = OpenAI(
        api_key=os.environ["OPENAI_API_KEY"],
        base_url=os.environ["OPENAI_BASE_URL"],
        timeout=60.0,
    )
    out = np.zeros((len(texts), EMBED_DIM), dtype=np.float32)
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        print(f"  embed segment batch {i // batch_size + 1}/{(len(texts) + batch_size - 1) // batch_size}", flush=True)
        resp = client.embeddings.create(
            model=EMBED_MODEL,
            input=batch,
            dimensions=EMBED_DIM,
            encoding_format="float",
        )
        for j, item in enumerate(resp.data):
            out[i + j] = np.asarray(item.embedding, dtype=np.float32)
    return out


def run_embed(args: argparse.Namespace) -> None:
    if not args.emb or not args.keys:
        raise SystemExit("--emb and --keys are required for embed/all")
    segments = load_jsonl(Path(args.out))
    texts = [seg.get("visual_search_text") or seg.get("visual") or "" for seg in segments]
    emb = embed_texts(texts, args.embed_batch_size)
    emb_path = Path(args.emb)
    keys_path = Path(args.keys)
    emb_path.parent.mkdir(parents=True, exist_ok=True)
    np.save(emb_path, emb)
    keys = [
        {
            "segment_id": seg["segment_id"],
            "file_key": seg.get("file_key"),
            "file": seg.get("file"),
            "start": seg.get("start"),
            "end": seg.get("end"),
        }
        for seg in segments
    ]
    keys_path.write_text(json.dumps(keys, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved embeddings: {emb_path} shape={emb.shape}")
    print(f"Saved keys: {keys_path}")


def main() -> None:
    args = parse_args()
    if args.stage in {"build", "all"}:
        segments = build_segments(args)
        write_jsonl(Path(args.out), segments)
        print(f"Saved visual segments: {args.out}")
        print(f"Segments: {len(segments)}")
    if args.stage in {"embed", "all"}:
        run_embed(args)


if __name__ == "__main__":
    main()
