# -*- coding: utf-8 -*-
"""Match blueprint visual beats to variable-length visual segments."""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np

sys.stdout.reconfigure(encoding="utf-8")

REPO_ROOT = Path(__file__).resolve().parent.parent
EMBED_MODEL = "text-embedding-v4"
EMBED_DIM = 1024


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser()
    ap.add_argument("--visual-beats", required=True)
    ap.add_argument("--visual-segments", required=True)
    ap.add_argument("--emb", required=True)
    ap.add_argument("--keys", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--top-k", type=int, default=40)
    ap.add_argument("--min-confidence", type=float, default=0.45)
    ap.add_argument("--min-score", type=float, default=0.0)
    ap.add_argument("--preferred-lang", default="", help="Comma-separated preferred source languages, e.g. zh")
    ap.add_argument("--preferred-lang-boost", type=float, default=0.0, help="Small ranking boost for preferred languages")
    return ap.parse_args()


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def load_jsonl(path: Path) -> list[dict]:
    rows = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def normalize(arr: np.ndarray) -> np.ndarray:
    arr = np.asarray(arr, dtype=np.float32)
    norms = np.linalg.norm(arr, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return arr / norms


def embed_texts(texts: list[str]) -> np.ndarray:
    from dotenv import load_dotenv
    from openai import OpenAI

    load_dotenv(dotenv_path=str(REPO_ROOT / ".env"))
    client = OpenAI(
        api_key=os.environ["OPENAI_API_KEY"],
        base_url=os.environ["OPENAI_BASE_URL"],
        timeout=60.0,
    )
    out = np.zeros((len(texts), EMBED_DIM), dtype=np.float32)
    for i in range(0, len(texts), 10):
        batch = texts[i : i + 10]
        print(f"  embed beat query batch {i // 10 + 1}/{(len(texts) + 9) // 10}", flush=True)
        resp = client.embeddings.create(
            model=EMBED_MODEL,
            input=batch,
            dimensions=EMBED_DIM,
            encoding_format="float",
        )
        for j, item in enumerate(resp.data):
            out[i + j] = np.asarray(item.embedding, dtype=np.float32)
    return normalize(out)


def beat_query_text(beat: dict) -> str:
    return "\n".join(
        [
            f"scene_type: {beat.get('scene_type', '')}",
            f"visual: {beat.get('visual', '')}",
            "subjects: " + " ".join(str(x) for x in beat.get("subjects", [])),
            "actions: " + " ".join(str(x) for x in beat.get("actions", [])),
            "must_have: " + " ".join(str(x) for x in beat.get("must_have", [])),
            "doctor_text: " + str(beat.get("doctor_text", "")),
        ]
    )


def segment_to_candidate(segment: dict, cosine: float, rank_score: float, lang_boost: float, rank: int) -> dict:
    return {
        "segment_id": segment.get("segment_id"),
        "file_key": segment.get("file_key"),
        "file": segment.get("file"),
        "mp4_path": segment.get("mp4_path"),
        "lang": segment.get("lang"),
        "start": segment.get("start"),
        "end": segment.get("end"),
        "duration": segment.get("duration"),
        "text": segment.get("visual"),
        "visual_one_line": segment.get("visual_one_line") or segment.get("visual"),
        "visual_scene_type": segment.get("visual_scene_type"),
        "visual_confidence": segment.get("visual_confidence"),
        "subjects": segment.get("subjects"),
        "actions": segment.get("actions"),
        "narration_text": segment.get("narration_text"),
        "atom_indices": segment.get("source_atom_ids", []),
        "source_atom_ids": segment.get("source_atom_ids", []),
        "cosine": float(cosine),
        "rank_score": float(rank_score),
        "lang_boost": float(lang_boost),
        "rank": rank,
    }


def assign_beat_times(beats: list[dict]) -> dict[str, tuple[float, float]]:
    by_seg: dict[str, list[dict]] = defaultdict(list)
    for beat in beats:
        by_seg[str(beat["seg_id"])].append(beat)
    out = {}
    for seg_id, items in by_seg.items():
        items.sort(key=lambda b: int(b.get("beat_index") or 0))
        start = float(items[0].get("time_start") or 0.0)
        end = float(items[0].get("time_end") or start)
        total = max(0.01, end - start)
        weights = [1.15 if b.get("role") == "primary" else 1.0 for b in items]
        weight_sum = sum(weights) or 1.0
        cursor = start
        for i, beat in enumerate(items):
            if i == len(items) - 1:
                beat_end = end
            else:
                beat_end = cursor + total * weights[i] / weight_sum
            out[beat["beat_id"]] = (round(cursor, 3), round(beat_end, 3))
            cursor = beat_end
    return out


def main() -> None:
    args = parse_args()
    beat_data = read_json(Path(args.visual_beats))
    beats = beat_data.get("visual_beats", [])
    segments = load_jsonl(Path(args.visual_segments))
    keys = read_json(Path(args.keys))
    emb = normalize(np.load(args.emb))
    seg_by_id = {str(seg["segment_id"]): seg for seg in segments}

    cand_segments = []
    cand_emb = []
    for i, key in enumerate(keys):
        seg = seg_by_id.get(str(key.get("segment_id")))
        if seg is None:
            continue
        try:
            conf = float(seg.get("visual_confidence") or 0.0)
        except (TypeError, ValueError):
            conf = 0.0
        if conf < args.min_confidence:
            continue
        cand_segments.append(seg)
        cand_emb.append(emb[i])
    cand_emb = normalize(np.vstack(cand_emb))
    print(f"Visual segment candidates: {len(cand_segments)} / {len(segments)}")

    query_texts = [beat_query_text(beat) for beat in beats]
    query_emb = embed_texts(query_texts)
    sim = query_emb @ cand_emb.T
    rank_sim = sim.copy()
    preferred_langs = {x.strip() for x in args.preferred_lang.split(",") if x.strip()}
    lang_boosts = np.zeros((len(cand_segments),), dtype=np.float32)
    if preferred_langs and args.preferred_lang_boost > 0:
        for i, seg in enumerate(cand_segments):
            if str(seg.get("lang") or "").strip() in preferred_langs:
                lang_boosts[i] = float(args.preferred_lang_boost)
        rank_sim = rank_sim + lang_boosts.reshape(1, -1)
        print(
            f"Preferred language boost: langs={sorted(preferred_langs)} "
            f"boost={args.preferred_lang_boost:.3f} candidates={int((lang_boosts > 0).sum())}",
            flush=True,
        )
    beat_times = assign_beat_times(beats)

    results = []
    accepted = 0
    for qi, beat in enumerate(beats):
        k = min(args.top_k, len(cand_segments))
        idxs = np.argpartition(-rank_sim[qi], k - 1)[:k]
        idxs = idxs[np.argsort(-rank_sim[qi, idxs])]
        candidates = [
            segment_to_candidate(
                cand_segments[idx],
                float(sim[qi, idx]),
                float(rank_sim[qi, idx]),
                float(lang_boosts[idx]),
                rank,
            )
            for rank, idx in enumerate(idxs.tolist(), 1)
        ]
        picked = candidates[0] if candidates and float(candidates[0].get("rank_score") or 0.0) >= args.min_score else None
        if picked:
            accepted += 1
        output_start, output_end = beat_times.get(beat["beat_id"], (beat.get("time_start"), beat.get("time_end")))
        visual_need = {
            "seg_id": beat["beat_id"],
            "beat_id": beat["beat_id"],
            "logic_seg_id": beat["seg_id"],
            "needs_animation": True,
            "scene_type": beat.get("scene_type", ""),
            "visual": beat.get("visual", ""),
            "subjects": beat.get("subjects", []),
            "actions": beat.get("actions", []),
            "negative": beat.get("avoid", []),
            "must_have": beat.get("must_have", []),
            "reason": beat.get("reason", ""),
        }
        results.append(
            {
                "seg_id": beat["seg_id"],
                "beat_id": beat["beat_id"],
                "beat_index": beat.get("beat_index"),
                "beat_count": beat.get("beat_count"),
                "bp_title": beat.get("bp_title"),
                "scene_id": beat.get("scene_id"),
                "scene_title": beat.get("scene_title"),
                "atoms_text": beat.get("doctor_text"),
                "template": beat.get("template"),
                "items": beat.get("items", []),
                "time_start": beat.get("time_start"),
                "time_end": beat.get("time_end"),
                "output_start": output_start,
                "output_end": output_end,
                "needs_animation": True,
                "visual_need": visual_need,
                "raw_pick": int(picked["rank"]) if picked else 0,
                "pick": int(picked["rank"]) if picked else 0,
                "accepted": bool(picked),
                "reject_reason": "" if picked else "no picked visual segment",
                "fit_score": float(picked["cosine"]) if picked else 0.0,
                "match_type": "same_visual_process" if picked else "none",
                "missing": [],
                "rerank_reason": "visual beat -> visual segment fallback; use Codex rerank before drafting",
                "picked": picked,
                "rejected_picked": None,
                "candidates_top_segments": candidates,
            }
        )

    data = {
        "bp_title": beat_data.get("bp_title"),
        "algo": "visual-beat-to-visual-segment-rag-v1-no-rerank",
        "params": vars(args),
        "n_visual_beats": len(beats),
        "n_picked": accepted,
        "results": results,
    }
    out_path = Path(args.out)
    write_json(out_path, data)
    print(f"Saved beat matches: {out_path}")
    print(f"Fallback accepted picks: {accepted}/{len(beats)}")
    for record in results[:30]:
        if record.get("accepted") and record.get("picked"):
            picked = record["picked"]
            print(
                f"  {record['beat_id']} -> {picked.get('file')} "
                f"[{float(picked.get('start') or 0.0):.2f}-{float(picked.get('end') or 0.0):.2f}s] "
                f"score={float(picked.get('cosine') or 0.0):.3f}"
            )


if __name__ == "__main__":
    main()
