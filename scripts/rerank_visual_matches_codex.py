# -*- coding: utf-8 -*-
"""Rerank visual-atom match candidates with Codex CLI.

This script treats the existing embedding/RAG matcher as recall, then asks
Codex CLI to choose the best candidate for each blueprint segment.  The output
keeps the same JSON shape consumed by generate-draft-from-matches.py.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import subprocess
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parent

DEFAULT_ACCEPTED_MATCH_TYPES = {
    "same_visual_process",
    "same_visual_object",
    "direct_medical_action",
}
ALL_MATCH_TYPES = {
    "same_visual_process",
    "same_visual_object",
    "direct_medical_action",
    "supporting_context",
    "related_topic",
    "generic_advice",
    "none",
}


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser()
    ap.add_argument("--matches", required=True, help="RAG matches JSON with candidates_top_segments")
    ap.add_argument("--out", required=True, help="Output matches JSON after Codex rerank")
    ap.add_argument("--schema", default=str(ROOT / "codex_rerank_schema.json"))
    ap.add_argument("--codex-cmd", default="codex")
    ap.add_argument("--model", default="gpt-5.4", help="Codex model used for reranking")
    ap.add_argument("--top-candidates", type=int, default=12)
    ap.add_argument("--batch-size", type=int, default=3)
    ap.add_argument("--concurrency", type=int, default=2)
    ap.add_argument("--timeout", type=int, default=360)
    ap.add_argument("--min-fit-score", type=float, default=0.72)
    ap.add_argument("--min-cosine", type=float, default=0.0)
    ap.add_argument("--accepted-match-types", default=",".join(sorted(DEFAULT_ACCEPTED_MATCH_TYPES)))
    ap.add_argument("--max-exact-reuse", type=int, default=1)
    ap.add_argument("--max-file-reuse", type=int, default=3)
    ap.add_argument("--max-basename-reuse", type=int, default=3)
    ap.add_argument("--logs-dir", default=str(REPO_ROOT / "local_artifacts" / "logs" / "codex_rerank_visual_matches"))
    return ap.parse_args()


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def parse_csv_set(value: str) -> set[str]:
    return {item.strip() for item in value.split(",") if item.strip()}


def clean_text(value: Any, limit: int = 420) -> str:
    text = str(value or "").replace("\r", " ").replace("\n", " ").strip()
    text = re.sub(r"\s+", " ", text)
    if len(text) > limit:
        return text[: limit - 3] + "..."
    return text


def basename(value: Any) -> str:
    if not value:
        return ""
    return Path(str(value)).name


def candidate_for_prompt(candidate: dict, idx: int) -> dict:
    visual = candidate.get("text") or candidate.get("visual_one_line") or ""
    return {
        "candidate_id": idx,
        "segment_id": candidate.get("segment_id"),
        "rag_rank": candidate.get("rank"),
        "cosine": round(float(candidate.get("cosine") or 0.0), 3),
        "rank_score": round(float(candidate.get("rank_score") or candidate.get("cosine") or 0.0), 3),
        "language": clean_text(candidate.get("lang"), 40),
        "file": basename(candidate.get("file") or candidate.get("mp4_path") or candidate.get("file_key")),
        "clip_sec": f"{float(candidate.get('start') or 0.0):.2f}-{float(candidate.get('end') or 0.0):.2f}",
        "visual": clean_text(visual, 520),
        "subjects": clean_text(candidate.get("subjects"), 240),
        "actions": clean_text(candidate.get("actions"), 240),
        "narration": clean_text(candidate.get("narration_text"), 260),
        "scene_type": clean_text(candidate.get("visual_scene_type"), 80),
    }


def record_id(record: dict) -> str:
    return str(record.get("beat_id") or record.get("seg_id") or "")


def segment_for_prompt(record: dict, top_candidates: int) -> dict:
    need = record.get("visual_need") or {}
    candidates = record.get("candidates_top_segments") or []
    candidates = candidates[:top_candidates]
    return {
        "seg_id": record_id(record),
        "logic_seg_id": str(record.get("seg_id") or ""),
        "beat_id": record.get("beat_id"),
        "doctor_text": clean_text(record.get("atoms_text"), 700),
        "visual_need": {
            "scene_type": need.get("scene_type") or "",
            "visual": clean_text(need.get("visual"), 650),
            "subjects": [clean_text(x, 80) for x in need.get("subjects", [])],
            "actions": [clean_text(x, 80) for x in need.get("actions", [])],
            "negative": [clean_text(x, 90) for x in need.get("negative", [])],
            "reason": clean_text(need.get("reason"), 260),
        },
        "candidates": [candidate_for_prompt(c, idx) for idx, c in enumerate(candidates, 1)],
    }


def build_prompt(batch: list[dict], top_candidates: int) -> str:
    payload = {
        "task": "rerank_visual_candidates",
        "segments": [segment_for_prompt(record, top_candidates) for record in batch],
    }
    payload_json = json.dumps(payload, ensure_ascii=False, indent=2)
    return f"""You are reranking medical animation clips for a Chinese doctor-video draft.

Input JSON contains several visual needs. Some are whole logic segments, and some are smaller visual beats inside a logic segment. Each item has a visual_need and 1-based candidate_id values.

Decision rules:
- Visible nouns/objects are most important: anatomy, pathology, device, molecule, plaque, thrombus, vessel wall, lumen, lipid core, fibrous cap.
- Visible actions/processes are second: deposition, narrowing, rupture, clot formation, blockage, dissolving, stent expansion, balloon inflation.
- Treat this as a coverage decision, not text similarity. For every candidate, mentally check:
  1. Does it show the primary visible noun/object?
  2. Does it show the primary visible action/process or the requested static state?
  3. Is the disease stage right (stable plaque vs rupture vs thrombus vs treatment)?
  4. Are there forbidden negatives in the visual_need?
  5. Is the image self-contained enough for a general viewer to understand without already knowing the anatomy?
- Do not choose a candidate merely because the general topic is similar. Wrong visible object or wrong process means pick 0.
- Avoid lifestyle, food, tea, pill bottle, doctor-talking, generic patient, generic heart, or generic advice clips unless that exact visible scene is requested.
- Do not require every secondary detail in a long visual_need. If the candidate clearly shows the main visible noun plus the main visible action/process, pick it and list missing secondary details.
- If the doctor_text is only an abstract claim about evidence, medication, risk, importance, or advice, and does not itself describe a visible anatomy/pathology/process, prefer pick=0. Do not consume a useful anatomy clip too early when the next sentence is more concrete.
- When a segment says severe stenosis such as 70-80% blockage, visible lumen narrowing and impaired blood flow are more important than an isolated fibrous-cap closeup.
- For professional structures like fibrous cap, lipid core, intima, endothelium, or calcification, prefer candidates that show the surrounding vessel/plaque context and the structure's location. Penalize isolated closeups or abstract layer textures that are technically related but hard for a lay viewer to understand.
- For fibrous-cap needs, the best candidate should show plaque plus cap covering/forming/thickening over it. A cap-only closeup, unlabeled layer, or ambiguous tissue surface should be supporting_context or pick=0 unless no clearer candidate exists.
- For plaque-inside-vessel-wall needs, prefer artery/vessel cross sections showing plaque embedded in the wall, lipid core, fibrous cap, intima, and lumen narrowing.
- For LDL/cholesterol deposition needs, prefer LDL/cholesterol particles depositing in the artery wall or becoming plaque.
- For plaque rupture/thrombus needs, the candidate must show rupture, platelets, clot/thrombus, or acute blockage. Plain stable plaque is not enough.
- If the best candidate is only background context, set pick=0. A nonzero pick should be usable in the draft.

Scoring:
- fit_score 0.90-1.00: almost exact visible object and action.
- fit_score 0.82-0.89: close match, minor detail missing.
- fit_score 0.72-0.81: usable partial match with main noun and main action present.
- fit_score below 0.72: not acceptable for placement; use pick=0 unless the schema still needs a rejected explanation.
- Nonzero picks should use match_type one of same_visual_process, same_visual_object, direct_medical_action.
- Use supporting_context, related_topic, generic_advice, or none with pick=0.
- Ignore candidate_id order when choosing. Lower-ranked RAG candidates can be better.

Return strict JSON matching the provided schema:
{{"results":[{{"seg_id":"...","pick":0,"fit_score":0.0,"match_type":"none","reason":"short reason","missing":[]}}]}}

There must be exactly one result for every input item. Use the input item's seg_id exactly in the output. The pick is candidate_id, or 0 if none fit.

INPUT_JSON:
{payload_json}
"""


def strip_json_fence(raw: str) -> str:
    raw = (raw or "").strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        if raw.startswith("json\n"):
            raw = raw[5:].strip()
    return raw


def parse_jsonish(raw: str) -> Any:
    raw = strip_json_fence(raw)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    match = re.search(r"(\{.*\})", raw, re.S)
    if not match:
        raise ValueError(f"no JSON object found in Codex output: {raw[:240]}")
    return json.loads(match.group(1))


def default_rerank(seg_id: str, reason: str) -> dict:
    return {
        "seg_id": seg_id,
        "pick": 0,
        "fit_score": 0.0,
        "match_type": "none",
        "reason": reason,
        "missing": [],
    }


def normalize_rerank(data: dict | None, seg_id: str, max_pick: int) -> dict:
    if not isinstance(data, dict):
        return default_rerank(seg_id, "Codex returned no result")
    try:
        pick = int(data.get("pick") or 0)
    except (TypeError, ValueError):
        pick = 0
    if pick < 0 or pick > max_pick:
        pick = 0
    try:
        fit_score = float(data.get("fit_score") or 0.0)
    except (TypeError, ValueError):
        fit_score = 0.0
    if not math.isfinite(fit_score):
        fit_score = 0.0
    fit_score = max(0.0, min(1.0, fit_score))
    match_type = str(data.get("match_type") or "none")
    if match_type not in ALL_MATCH_TYPES:
        match_type = "none"
    missing = data.get("missing")
    if not isinstance(missing, list):
        missing = []
    return {
        "seg_id": seg_id,
        "pick": pick,
        "fit_score": fit_score,
        "match_type": match_type,
        "reason": clean_text(data.get("reason") or "", 500),
        "missing": [clean_text(item, 120) for item in missing],
    }


def run_codex_batch(
    batch_idx: int,
    batch: list[dict],
    args: argparse.Namespace,
    logs_dir: Path,
) -> dict[str, dict]:
    prompt = build_prompt(batch, args.top_candidates)
    prompt_path = logs_dir / f"batch_{batch_idx:03d}_prompt.txt"
    output_path = logs_dir / f"batch_{batch_idx:03d}_last_message.json"
    stdout_path = logs_dir / f"batch_{batch_idx:03d}_stdout.txt"
    stderr_path = logs_dir / f"batch_{batch_idx:03d}_stderr.txt"
    prompt_path.write_text(prompt, encoding="utf-8")
    if output_path.exists():
        output_path.unlink()

    cmd = [
        args.codex_cmd,
        "exec",
        "-m",
        args.model,
        "-s",
        "read-only",
        "--skip-git-repo-check",
        "-C",
        str(REPO_ROOT),
        "--output-schema",
        str(Path(args.schema)),
        "--output-last-message",
        str(output_path),
        "-",
    ]
    started = time.time()
    try:
        result = subprocess.run(
            cmd,
            input=prompt,
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            timeout=args.timeout,
            cwd=str(REPO_ROOT),
        )
        stdout_path.write_text(result.stdout or "", encoding="utf-8", errors="replace")
        stderr_path.write_text(result.stderr or "", encoding="utf-8", errors="replace")
        if not output_path.exists():
            raise RuntimeError(
                f"Codex produced no output-last-message; rc={result.returncode}; stderr={(result.stderr or '')[:240]}"
            )
        parsed = parse_jsonish(output_path.read_text(encoding="utf-8", errors="replace"))
        results = parsed.get("results", []) if isinstance(parsed, dict) else []
        by_seg = {
            str(item.get("seg_id") or ""): item
            for item in results
            if isinstance(item, dict) and item.get("seg_id")
        }
        normalized = {}
        for record in batch:
            seg_id = record_id(record)
            max_pick = min(args.top_candidates, len(record.get("candidates_top_segments") or []))
            normalized[seg_id] = normalize_rerank(by_seg.get(seg_id), seg_id, max_pick)
        elapsed = time.time() - started
        print(f"  batch {batch_idx:03d}: ok in {elapsed:.1f}s ({len(batch)} segs)", flush=True)
        return normalized
    except Exception as exc:
        elapsed = time.time() - started
        stdout_path.write_text(f"batch failed after {elapsed:.1f}s: {exc}\n", encoding="utf-8")
        print(f"  batch {batch_idx:03d}: failed after {elapsed:.1f}s: {exc}", flush=True)
        return {
            record_id(record): default_rerank(
                record_id(record),
                f"Codex rerank error: {exc}",
            )
            for record in batch
        }


def candidate_keys(candidate: dict) -> tuple[tuple[str, float, float], str, str]:
    asset = str(candidate.get("mp4_path") or candidate.get("file") or "").lower()
    start = round(float(candidate.get("start") or 0.0), 2)
    end = round(float(candidate.get("end") or 0.0), 2)
    file_key = asset
    basename_key = Path(asset).name.lower()
    return (asset, start, end), file_key, basename_key


def reject_reason(
    rr: dict,
    candidate: dict | None,
    accepted_types: set[str],
    args: argparse.Namespace,
    exact_reuse: dict,
    file_reuse: dict,
    basename_reuse: dict,
) -> str:
    if not candidate:
        return "no valid Codex pick"
    if float(rr.get("fit_score") or 0.0) < args.min_fit_score:
        return f"fit_score {float(rr.get('fit_score') or 0.0):.2f} < {args.min_fit_score:.2f}"
    if rr.get("match_type") not in accepted_types:
        return f"match_type {rr.get('match_type')} not accepted"
    if float(candidate.get("cosine") or 0.0) < args.min_cosine:
        return f"cosine {float(candidate.get('cosine') or 0.0):.2f} < {args.min_cosine:.2f}"
    exact_key, file_key, basename_key = candidate_keys(candidate)
    if exact_reuse[exact_key] >= args.max_exact_reuse:
        return f"exact asset clip reused {exact_reuse[exact_key]} times"
    if file_reuse[file_key] >= args.max_file_reuse:
        return f"asset file reused {file_reuse[file_key]} times"
    if basename_reuse[basename_key] >= args.max_basename_reuse:
        return f"asset basename reused {basename_reuse[basename_key]} times"
    return ""


def apply_reranks(data: dict, rr_by_seg: dict[str, dict], args: argparse.Namespace) -> dict:
    accepted_types = parse_csv_set(args.accepted_match_types)
    exact_reuse: dict[tuple[str, float, float], int] = defaultdict(int)
    file_reuse: dict[str, int] = defaultdict(int)
    basename_reuse: dict[str, int] = defaultdict(int)
    accepted = 0

    for record in data.get("results", []):
        seg_id = record_id(record)
        candidates = record.get("candidates_top_segments") or []
        needs_animation = bool(record.get("needs_animation"))
        if not needs_animation:
            rr = default_rerank(seg_id, (record.get("visual_need") or {}).get("reason") or "no animation needed")
        elif not candidates:
            rr = default_rerank(seg_id, "no RAG candidates")
        else:
            rr = rr_by_seg.get(seg_id, default_rerank(seg_id, "missing Codex rerank"))

        raw_pick = int(rr.get("pick") or 0)
        raw_picked = candidates[raw_pick - 1] if 1 <= raw_pick <= len(candidates) else None
        reason = reject_reason(
            rr,
            raw_picked,
            accepted_types,
            args,
            exact_reuse,
            file_reuse,
            basename_reuse,
        )
        picked = None if reason else raw_picked
        if picked:
            exact_key, file_key, basename_key = candidate_keys(picked)
            exact_reuse[exact_key] += 1
            file_reuse[file_key] += 1
            basename_reuse[basename_key] += 1
            accepted += 1

        record["raw_pick"] = raw_pick
        record["pick"] = raw_pick if picked else 0
        record["accepted"] = bool(picked)
        record["reject_reason"] = reason
        record["fit_score"] = float(rr.get("fit_score") or 0.0)
        record["match_type"] = rr.get("match_type") or "none"
        record["missing"] = rr.get("missing") or []
        record["rerank_reason"] = rr.get("reason") or ""
        record["picked"] = picked
        record["rejected_picked"] = raw_picked if not picked else None
        record["codex_rerank"] = {
            "model": args.model,
            "top_candidates": args.top_candidates,
            **rr,
        }

    data["algo"] = f"{data.get('algo', 'visual-atom-rag')} + codex-cli-rerank"
    data["n_picked"] = accepted
    params = data.setdefault("params", {})
    params["codex_rerank"] = {
        "model": args.model,
        "top_candidates": args.top_candidates,
        "batch_size": args.batch_size,
        "concurrency": args.concurrency,
        "min_fit_score": args.min_fit_score,
        "accepted_match_types": sorted(accepted_types),
        "max_exact_reuse": args.max_exact_reuse,
        "max_file_reuse": args.max_file_reuse,
        "max_basename_reuse": args.max_basename_reuse,
    }
    return data


def main() -> None:
    args = parse_args()
    matches_path = Path(args.matches)
    out_path = Path(args.out)
    logs_dir = Path(args.logs_dir) / time.strftime("%Y%m%d_%H%M%S")
    logs_dir.mkdir(parents=True, exist_ok=True)

    data = read_json(matches_path)
    records = [
        record
        for record in data.get("results", [])
        if record.get("needs_animation") and record.get("candidates_top_segments")
    ]
    batches = [records[i : i + args.batch_size] for i in range(0, len(records), args.batch_size)]

    print(f"Loaded matches: {matches_path}")
    print(f"Segments to rerank: {len(records)} in {len(batches)} batches")
    print(f"Codex model: {args.model}; concurrency={args.concurrency}; logs={logs_dir}")

    rr_by_seg: dict[str, dict] = {}
    if batches:
        with ThreadPoolExecutor(max_workers=max(1, args.concurrency)) as executor:
            futures = {
                executor.submit(run_codex_batch, idx + 1, batch, args, logs_dir): idx
                for idx, batch in enumerate(batches)
            }
            done = 0
            for future in as_completed(futures):
                rr_by_seg.update(future.result())
                done += 1
                print(f"  progress: {done}/{len(batches)} batches", flush=True)

    data = apply_reranks(data, rr_by_seg, args)
    write_json(out_path, data)

    print(f"Saved Codex-reranked matches: {out_path}")
    print(f"Accepted picks: {data.get('n_picked', 0)}/{len(data.get('results', []))}")
    for record in data.get("results", []):
        if record.get("accepted") and record.get("picked"):
            picked = record["picked"]
            print(
                f"  {record.get('seg_id')} -> {basename(picked.get('file') or picked.get('mp4_path'))} "
                f"[{float(picked.get('start') or 0.0):.2f}-{float(picked.get('end') or 0.0):.2f}s] "
                f"fit={float(record.get('fit_score') or 0.0):.2f} "
                f"type={record.get('match_type')}"
            )


if __name__ == "__main__":
    main()
