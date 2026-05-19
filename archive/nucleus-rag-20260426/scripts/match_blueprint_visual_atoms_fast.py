# -*- coding: utf-8 -*-
"""Fast no-rerank visual atom matcher.

This is the fallback path used when Claude/Sonnet is rate-limited. It reuses
cached blueprint visual_needs, embeds those needs, retrieves visual_atoms, and
emits the same matches JSON shape consumed by generate-draft-from-matches.py.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

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
    ap.add_argument("--top-k", type=int, default=20)
    ap.add_argument("--min-score", type=float, default=0.70)
    ap.add_argument("--min-confidence", type=float, default=0.45)
    ap.add_argument("--min-dur", type=float, default=5.0)
    ap.add_argument("--max-dur", type=float, default=10.0)
    ap.add_argument("--max-gap", type=float, default=2.5)
    ap.add_argument("--max-exact-reuse", type=int, default=1)
    ap.add_argument("--max-file-reuse", type=int, default=3)
    return ap.parse_args()


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


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


def atom_text(atom: dict) -> str:
    return str(atom.get("subtitle_text") or atom.get("text") or "")


def atom_is_keep(atom: dict) -> bool:
    return atom.get("status", "keep") == "keep"


def atom_time(atom: dict, key: str) -> float:
    t = atom.get("time") or {}
    if isinstance(t, dict) and key in t:
        return float(t[key])
    fallback = "start_ms" if key == "start" else "end_ms"
    if fallback in atom:
        return float(atom[fallback]) / 1000.0
    return 0.0


def load_blueprint_segments(path: Path) -> tuple[list[dict], str, int]:
    bp = read_json(path)
    title = bp.get("title", "")
    flat = []
    for scene in bp.get("scenes", []):
        for ls in scene.get("logic_segments", []):
            atoms = [a for a in ls.get("atoms", []) if atom_is_keep(a)]
            if not atoms:
                atoms = ls.get("atoms", [])
            if not atoms:
                continue
            flat.append(
                {
                    "seg_id": ls.get("id"),
                    "bp_title": title,
                    "scene_id": scene.get("id", ""),
                    "scene_title": scene.get("title", ""),
                    "template": ls.get("template"),
                    "items": [str(it.get("text", "")) for it in ls.get("items", [])],
                    "atoms_text": "".join(atom_text(a) for a in atoms),
                    "time_start": atom_time(atoms[0], "start"),
                    "time_end": atom_time(atoms[-1], "end"),
                }
            )
    return flat, title, len(bp.get("scenes", []))


def need_to_text(need: dict) -> str:
    return "\n".join(
        [
            f"scene_type: {need.get('scene_type', '')}",
            f"visual: {need.get('visual', '')}",
            "subjects: " + " ".join(str(x) for x in need.get("subjects", [])),
            "actions: " + " ".join(str(x) for x in need.get("actions", [])),
        ]
    )


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
        print(f"  embed query batch {i // 10 + 1}/{(len(texts) + 9) // 10}", flush=True)
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
    return " / ".join(vals[:5])


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
    return " / ".join(vals[:5])


def expand(row: dict, rows_by_file: dict[str, list[dict]], args: argparse.Namespace) -> dict:
    file_key = str(row.get("file_key") or row.get("file"))
    file_rows = rows_by_file.get(file_key, [row])
    pos_by_id = {int(r["atom_id"]): i for i, r in enumerate(file_rows)}
    pos = pos_by_id.get(int(row["atom_id"]), 0)
    lo = hi = pos
    start = float(file_rows[lo].get("start") or 0.0)
    end = float(file_rows[hi].get("end") or start)
    for _ in range(40):
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
        "text": "；".join(str(r.get("visual_one_line") or "") for r in picked_rows if r.get("visual_one_line")),
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

    query_texts = [need_to_text(need_by_id.get(str(seg["seg_id"]), {})) for seg in segs]
    query_emb = embed_texts(query_texts)
    sim = query_emb @ cand_emb.T

    exact_reuse: dict[tuple, int] = defaultdict(int)
    file_reuse: dict[str, int] = defaultdict(int)
    results = []
    accepted = 0
    for qi, seg in enumerate(segs):
        need = need_by_id.get(str(seg["seg_id"]), {})
        candidates = []
        picked = None
        if need.get("needs_animation"):
            k = min(args.top_k, len(cand_rows))
            idxs = np.argpartition(-sim[qi], k - 1)[:k]
            idxs = idxs[np.argsort(-sim[qi, idxs])]
            for rank, idx in enumerate(idxs.tolist(), 1):
                cand = expand(cand_rows[idx], rows_by_file, args)
                cand["cosine"] = float(sim[qi, idx])
                cand["rank"] = rank
                candidates.append(cand)
            for cand in candidates:
                exact_key = (
                    str(cand.get("mp4_path") or cand.get("file")).lower(),
                    round(float(cand["start"]), 2),
                    round(float(cand["end"]), 2),
                )
                file_key = str(cand.get("mp4_path") or cand.get("file")).lower()
                if cand["cosine"] < args.min_score:
                    continue
                if exact_reuse[exact_key] >= args.max_exact_reuse:
                    continue
                if file_reuse[file_key] >= args.max_file_reuse:
                    continue
                picked = cand
                exact_reuse[exact_key] += 1
                file_reuse[file_key] += 1
                break
        if picked:
            accepted += 1
        reject_reason = "" if picked else ("no picked asset" if need.get("needs_animation") else "no animation needed")
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
                "raw_pick": int(picked["rank"]) if picked else 0,
                "pick": int(picked["rank"]) if picked else 0,
                "accepted": bool(picked),
                "reject_reason": reject_reason,
                "fit_score": float(picked["cosine"]) if picked else 0.0,
                "match_type": "same_visual_process" if picked else "none",
                "missing": [],
                "rerank_reason": "embedding visual need -> visual atom fallback (no Sonnet rerank)",
                "picked": picked,
                "rejected_picked": None,
                "candidates_top_segments": candidates,
            }
        )

    data = {
        "bp_title": title,
        "algo": "fast-visual-atom-embedding-no-rerank",
        "params": vars(args),
        "n_scenes": n_scenes,
        "n_segs": len(segs),
        "n_visual_needs": sum(1 for n in need_by_id.values() if n.get("needs_animation")),
        "n_picked": accepted,
        "results": results,
    }
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved matches: {out_path}")
    print(f"Accepted picks: {accepted}/{len(segs)}")
    for r in results:
        if r["accepted"]:
            p = r["picked"]
            print(f"  {r['seg_id']} -> {p.get('file')} [{p['start']:.2f}-{p['end']:.2f}] score={p['cosine']:.3f}")


if __name__ == "__main__":
    main()
