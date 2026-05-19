# -*- coding: utf-8 -*-
"""Multi-query visual-atom recall for blueprint segments.

The old fast matcher used one embedding query per logic block.  That is brittle
when a block contains several visual ideas or when the visual_need is too
specific.  This script keeps the output shape used by the draft generator, but
builds candidates from several query variants per segment so the LLM reranker
has a better pool to choose from.
"""

from __future__ import annotations

import argparse
import json
import os
import re
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
    ap.add_argument("--bp", required=True)
    ap.add_argument("--visual-needs", required=True)
    ap.add_argument("--visual-atoms", required=True)
    ap.add_argument("--emb", required=True)
    ap.add_argument("--keys", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--top-k", type=int, default=60)
    ap.add_argument("--per-query-k", type=int, default=80)
    ap.add_argument("--min-score", type=float, default=0.0)
    ap.add_argument("--min-confidence", type=float, default=0.45)
    ap.add_argument("--min-dur", type=float, default=5.0)
    ap.add_argument("--max-dur", type=float, default=12.0)
    ap.add_argument("--max-gap", type=float, default=2.5)
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


def clean_text(value: Any, limit: int = 900) -> str:
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


def load_blueprint_segments(path: Path) -> tuple[list[dict], str, int]:
    bp = read_json(path)
    title = bp.get("title", "")
    flat = []
    for scene in bp.get("scenes", []):
        for logic_segment in scene.get("logic_segments", []):
            atoms = [a for a in logic_segment.get("atoms", []) if atom_is_keep(a)]
            if not atoms:
                atoms = logic_segment.get("atoms", [])
            if not atoms:
                continue
            flat.append(
                {
                    "seg_id": logic_segment.get("id"),
                    "bp_title": title,
                    "scene_id": scene.get("id", ""),
                    "scene_title": scene.get("title", ""),
                    "template": logic_segment.get("template"),
                    "items": [str(it.get("text", "")) for it in logic_segment.get("items", [])],
                    "atoms_text": "".join(atom_text(a) for a in atoms),
                    "time_start": atom_time(atoms[0], "start"),
                    "time_end": atom_time(atoms[-1], "end"),
                }
            )
    return flat, title, len(bp.get("scenes", []))


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
        print(f"  embed recall query batch {i // 10 + 1}/{(len(texts) + 9) // 10}", flush=True)
        resp = client.embeddings.create(
            model=EMBED_MODEL,
            input=batch,
            dimensions=EMBED_DIM,
            encoding_format="float",
        )
        for j, item in enumerate(resp.data):
            out[i + j] = np.asarray(item.embedding, dtype=np.float32)
    return normalize(out)


def subject_text(row: dict) -> str:
    vals = []
    for item in row.get("primary_subjects", []) + row.get("secondary_subjects", []):
        if isinstance(item, dict) and item.get("subject"):
            vals.append(str(item["subject"]))
    return " / ".join(vals[:6])


def action_text(row: dict) -> str:
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
    return " / ".join(vals[:6])


def split_visual_clauses(text: str) -> list[str]:
    parts = [p.strip() for p in re.split(r"[，,；;。.!！、]", text or "") if p.strip()]
    out = []
    for part in parts:
        if len(part) < 4:
            continue
        out.append(part)
    return out[:5]


def add_query(queries: list[dict], seen: set[str], name: str, text: str) -> None:
    text = clean_text(text, 900)
    if not text or text in seen:
        return
    seen.add(text)
    queries.append({"name": name, "text": text})


def query_variants(seg: dict, need: dict) -> list[dict]:
    queries: list[dict] = []
    seen: set[str] = set()
    visual = clean_text(need.get("visual"), 900)
    subjects = [clean_text(x, 80) for x in need.get("subjects", []) if clean_text(x, 80)]
    actions = [clean_text(x, 80) for x in need.get("actions", []) if clean_text(x, 80)]
    doctor_text = clean_text(seg.get("atoms_text"), 500)

    add_query(
        queries,
        seen,
        "visual_full",
        "\n".join(
            [
                f"scene_type: {need.get('scene_type', '')}",
                f"visual: {visual}",
                "subjects: " + " ".join(subjects),
                "actions: " + " ".join(actions),
            ]
        ),
    )
    add_query(queries, seen, "subjects_actions", " ".join(subjects + actions))
    add_query(queries, seen, "subjects_only", " ".join(subjects))
    add_query(queries, seen, "actions_only", " ".join(actions))
    add_query(queries, seen, "doctor_text", doctor_text)
    for i, clause in enumerate(split_visual_clauses(visual), 1):
        add_query(
            queries,
            seen,
            f"visual_clause_{i}",
            " ".join([clause, "subjects:", " ".join(subjects[:4]), "actions:", " ".join(actions[:4])]),
        )
    return queries


def expand(row: dict, rows_by_file: dict[str, list[dict]], args: argparse.Namespace) -> dict:
    file_key = str(row.get("file_key") or row.get("file"))
    file_rows = rows_by_file.get(file_key, [row])
    pos_by_id = {int(r["atom_id"]): i for i, r in enumerate(file_rows)}
    pos = pos_by_id.get(int(row["atom_id"]), 0)
    lo = hi = pos
    start = float(file_rows[lo].get("start") or 0.0)
    end = float(file_rows[hi].get("end") or start)
    for _ in range(80):
        if end - start >= args.min_dur:
            break
        changed = False
        if hi + 1 < len(file_rows):
            nxt_start = float(file_rows[hi + 1].get("start") or 0.0)
            nxt_end = float(file_rows[hi + 1].get("end") or nxt_start)
            if nxt_start - end <= args.max_gap and nxt_end - start <= args.max_dur:
                hi += 1
                end = nxt_end
                changed = True
        if end - start >= args.min_dur:
            break
        if lo > 0:
            prv_start = float(file_rows[lo - 1].get("start") or start)
            prv_end = float(file_rows[lo - 1].get("end") or prv_start)
            if start - prv_end <= args.max_gap and end - prv_start <= args.max_dur:
                lo -= 1
                start = prv_start
                changed = True
        if not changed:
            break
    picked_rows = file_rows[lo : hi + 1]
    return {
        "file_key": file_key,
        "start": round(start, 3),
        "end": round(end, 3),
        "text": " | ".join(str(r.get("visual_one_line") or "") for r in picked_rows if r.get("visual_one_line")),
        "narration_text": "".join(str(r.get("narration_text") or "") for r in picked_rows),
        "atom_indices": [int(r["atom_id"]) for r in picked_rows],
        "lang": row.get("lang"),
        "file": row.get("file"),
        "mp4_path": row.get("mp4_path"),
        "visual_one_line": row.get("visual_one_line"),
        "visual_scene_type": row.get("visual_scene_type"),
        "visual_confidence": row.get("visual_confidence"),
        "subjects": subject_text(row),
        "actions": action_text(row),
    }


def candidate_key(candidate: dict) -> tuple[str, float, float]:
    asset = str(candidate.get("mp4_path") or candidate.get("file") or candidate.get("file_key") or "").lower()
    return (asset, round(float(candidate.get("start") or 0.0), 2), round(float(candidate.get("end") or 0.0), 2))


def retrieve_for_segment(
    query_emb: np.ndarray,
    queries: list[dict],
    cand_emb: np.ndarray,
    cand_rows: list[dict],
    rows_by_file: dict[str, list[dict]],
    args: argparse.Namespace,
) -> list[dict]:
    hits: dict[int, dict] = {}
    sim = query_emb @ cand_emb.T
    per_query_k = min(args.per_query_k, len(cand_rows))
    for qi, query in enumerate(queries):
        idxs = np.argpartition(-sim[qi], per_query_k - 1)[:per_query_k]
        idxs = idxs[np.argsort(-sim[qi, idxs])]
        for idx in idxs.tolist():
            score = float(sim[qi, idx])
            hit = hits.setdefault(
                idx,
                {
                    "max_score": score,
                    "best_query": query["name"],
                    "query_hits": [],
                },
            )
            if score > hit["max_score"]:
                hit["max_score"] = score
                hit["best_query"] = query["name"]
            hit["query_hits"].append({"query": query["name"], "score": round(score, 4)})

    deduped: dict[tuple[str, float, float], dict] = {}
    for idx, hit in hits.items():
        candidate = expand(cand_rows[idx], rows_by_file, args)
        key = candidate_key(candidate)
        unique_query_hits = {}
        for qh in hit["query_hits"]:
            name = qh["query"]
            if name not in unique_query_hits or qh["score"] > unique_query_hits[name]["score"]:
                unique_query_hits[name] = qh
        candidate["cosine"] = float(hit["max_score"])
        candidate["recall_score"] = float(hit["max_score"]) + 0.006 * min(len(unique_query_hits), 6)
        candidate["best_query"] = hit["best_query"]
        candidate["query_hits"] = sorted(unique_query_hits.values(), key=lambda item: item["score"], reverse=True)
        current = deduped.get(key)
        if current is None or candidate["recall_score"] > current["recall_score"]:
            deduped[key] = candidate

    candidates = sorted(deduped.values(), key=lambda c: c["recall_score"], reverse=True)
    candidates = candidates[: args.top_k]
    for rank, candidate in enumerate(candidates, 1):
        candidate["rank"] = rank
    return candidates


def main() -> None:
    args = parse_args()
    segs, title, n_scenes = load_blueprint_segments(Path(args.bp))
    needs_data = read_json(Path(args.visual_needs))
    needs = needs_data.get("visual_needs", needs_data) if isinstance(needs_data, dict) else needs_data
    need_by_id = {str(n["seg_id"]): n for n in needs}
    print(f'Blueprint "{title}": {n_scenes} scenes, {len(segs)} segs')

    rows = load_jsonl(Path(args.visual_atoms))
    keys = read_json(Path(args.keys))
    emb = normalize(np.load(args.emb))
    row_by_atom_id = {int(r["atom_id"]): r for r in rows}
    cand_rows = []
    cand_emb = []
    for i, key in enumerate(keys):
        row = row_by_atom_id.get(int(key["atom_id"]))
        if row is None:
            continue
        if float(row.get("visual_confidence") or 0.0) < args.min_confidence:
            continue
        cand_rows.append(row)
        cand_emb.append(emb[i])
    cand_emb = normalize(np.vstack(cand_emb))
    print(f"Visual atom candidates: {len(cand_rows)} / {len(rows)}")

    rows_by_file: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        rows_by_file[str(row.get("file_key") or row.get("file"))].append(row)
    for file_key in rows_by_file:
        rows_by_file[file_key].sort(key=lambda r: float(r.get("start") or 0.0))

    query_plan = []
    for seg in segs:
        need = need_by_id.get(str(seg["seg_id"]), {})
        queries = query_variants(seg, need) if need.get("needs_animation") else []
        query_plan.append((seg, need, queries))
    flat_queries = [query["text"] for _, _, queries in query_plan for query in queries]
    print(f"Recall query variants: {len(flat_queries)} for {sum(1 for _, _, q in query_plan if q)} visual segments")
    flat_emb = embed_texts(flat_queries) if flat_queries else np.zeros((0, EMBED_DIM), dtype=np.float32)

    results = []
    accepted = 0
    emb_offset = 0
    for seg, need, queries in query_plan:
        candidates = []
        if need.get("needs_animation") and queries:
            query_emb = flat_emb[emb_offset : emb_offset + len(queries)]
            emb_offset += len(queries)
            candidates = retrieve_for_segment(query_emb, queries, cand_emb, cand_rows, rows_by_file, args)
        picked = candidates[0] if candidates and float(candidates[0].get("cosine") or 0.0) >= args.min_score else None
        if picked:
            accepted += 1
        results.append(
            {
                "seg_id": seg["seg_id"],
                "bp_title": seg["bp_title"],
                "scene_id": seg["scene_id"],
                "scene_title": seg["scene_title"],
                "atoms_text": seg["atoms_text"],
                "template": seg["template"],
                "items": seg["items"],
                "time_start": seg["time_start"],
                "time_end": seg["time_end"],
                "needs_animation": bool(need.get("needs_animation")),
                "visual_need": need,
                "recall_queries": queries,
                "raw_pick": int(picked["rank"]) if picked else 0,
                "pick": int(picked["rank"]) if picked else 0,
                "accepted": bool(picked),
                "reject_reason": "" if picked else ("no picked asset" if need.get("needs_animation") else "no animation needed"),
                "fit_score": float(picked["cosine"]) if picked else 0.0,
                "match_type": "same_visual_process" if picked else "none",
                "missing": [],
                "rerank_reason": "multi-query visual atom recall fallback; use Codex rerank before drafting",
                "picked": picked,
                "rejected_picked": None,
                "candidates_top_segments": candidates,
            }
        )

    data = {
        "bp_title": title,
        "algo": "visual-atom-multi-query-recall-v2-no-rerank",
        "params": vars(args),
        "n_scenes": n_scenes,
        "n_segs": len(segs),
        "n_visual_needs": sum(1 for n in need_by_id.values() if n.get("needs_animation")),
        "n_picked": accepted,
        "results": results,
    }
    out_path = Path(args.out)
    write_json(out_path, data)
    print(f"Saved matches: {out_path}")
    print(f"Fallback accepted picks: {accepted}/{len(segs)}")
    for record in results:
        if record["accepted"] and record["picked"]:
            picked = record["picked"]
            print(
                f"  {record['seg_id']} -> {picked.get('file')} "
                f"[{float(picked.get('start') or 0.0):.2f}-{float(picked.get('end') or 0.0):.2f}s] "
                f"score={float(picked.get('cosine') or 0.0):.3f} best_query={picked.get('best_query')}"
            )


if __name__ == "__main__":
    main()
