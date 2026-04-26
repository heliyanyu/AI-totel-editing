# -*- coding: utf-8 -*-
"""Human feedback utilities for asset match quality.

Workflow:
  1. export-review: create a CSV from a matches JSON for editors to review.
  2. import-review: append non-empty editor feedback rows to JSONL.
  3. apply: apply accumulated feedback to a matches JSON before drafting/rerank.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.stdout.reconfigure(encoding="utf-8")

DEFAULT_FEEDBACK = Path("scripts/asset_index/asset_feedback.jsonl")
REJECT_VERDICTS = {"bad", "reject", "discard", "drop", "not_readable", "wrong"}
PENALIZE_VERDICTS = {"penalize", "weak", "unclear"}
PREFER_VERDICTS = {"good", "prefer", "approved"}
RETAG_VERDICTS = {"retag", "relabel"}


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def load_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    rows = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def append_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="\n") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def iter_records(matches: dict) -> list[dict]:
    if isinstance(matches.get("results"), list):
        return matches["results"]
    if isinstance(matches.get("matches"), list):
        return matches["matches"]
    return []


def clean(value: Any) -> str:
    return str(value or "").replace("\r", " ").replace("\n", " ").strip()


def basename(value: Any) -> str:
    return Path(str(value or "")).name.lower()


def asset_key(candidate: dict) -> tuple[str, float, float]:
    asset = str(candidate.get("mp4_path") or candidate.get("file") or candidate.get("file_key") or "").lower()
    return (asset, round(float(candidate.get("start") or 0.0), 2), round(float(candidate.get("end") or 0.0), 2))


def candidate_label(candidate: dict | None) -> str:
    if not candidate:
        return ""
    return f"{candidate.get('file') or candidate.get('mp4_path')} [{candidate.get('start')}-{candidate.get('end')}]"


def export_review(args: argparse.Namespace) -> None:
    matches = read_json(Path(args.matches))
    rows = []
    clip_no = 0
    for record in iter_records(matches):
        picked = record.get("picked")
        if args.accepted_only and not (record.get("accepted") and picked):
            continue
        if picked:
            candidates = [picked]
        else:
            candidates = (record.get("candidates_top_segments") or [])[: args.top_candidates]
        for candidate in candidates:
            clip_no += 1
            visual_need = record.get("visual_need") or {}
            rows.append(
                {
                    "clip_no": clip_no,
                    "seg_id": record.get("seg_id", ""),
                    "beat_id": record.get("beat_id", ""),
                    "beat_index": record.get("beat_index", ""),
                    "asset_file": candidate.get("file") or "",
                    "mp4_path": candidate.get("mp4_path") or "",
                    "asset_start": candidate.get("start", ""),
                    "asset_end": candidate.get("end", ""),
                    "segment_id": candidate.get("segment_id", ""),
                    "source_atom_ids": " ".join(str(x) for x in candidate.get("source_atom_ids") or candidate.get("atom_indices") or []),
                    "fit_score": record.get("fit_score", ""),
                    "match_type": record.get("match_type", ""),
                    "doctor_text": clean(record.get("atoms_text", "")),
                    "visual_need": clean(visual_need.get("visual", "")),
                    "picked_visual": clean(candidate.get("visual_one_line") or candidate.get("text") or ""),
                    "subjects": clean(candidate.get("subjects", "")),
                    "actions": clean(candidate.get("actions", "")),
                    "narration": clean(candidate.get("narration_text", "")),
                    "rerank_reason": clean(record.get("rerank_reason", "")),
                    "feedback_verdict": "",
                    "feedback_scope": "exact_segment",
                    "feedback_reason": "",
                    "retag_visual": "",
                    "retag_subjects": "",
                    "retag_actions": "",
                }
            )
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()) if rows else [])
        if rows:
            writer.writeheader()
            writer.writerows(rows)
    print(f"Exported review CSV: {out}")
    print(f"Rows: {len(rows)}")


def normalize_verdict(value: str) -> str:
    return clean(value).lower()


def import_review(args: argparse.Namespace) -> None:
    csv_path = Path(args.csv)
    rows = []
    now = datetime.now(timezone.utc).isoformat()
    with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            verdict = normalize_verdict(row.get("feedback_verdict", ""))
            if not verdict or verdict in {"ok", "neutral", "skip"}:
                continue
            if verdict in REJECT_VERDICTS:
                normalized = "reject"
            elif verdict in PENALIZE_VERDICTS:
                normalized = "penalize"
            elif verdict in PREFER_VERDICTS:
                normalized = "prefer"
            elif verdict in RETAG_VERDICTS:
                normalized = "retag"
            else:
                normalized = verdict
            rows.append(
                {
                    "created_at": now,
                    "source_review_csv": str(csv_path),
                    "verdict": normalized,
                    "raw_verdict": row.get("feedback_verdict", ""),
                    "scope": row.get("feedback_scope") or "exact_segment",
                    "reason": row.get("feedback_reason") or "",
                    "seg_id": row.get("seg_id") or "",
                    "beat_id": row.get("beat_id") or "",
                    "asset_file": row.get("asset_file") or "",
                    "mp4_path": row.get("mp4_path") or "",
                    "start": row.get("asset_start") or "",
                    "end": row.get("asset_end") or "",
                    "segment_id": row.get("segment_id") or "",
                    "retag": {
                        "visual": row.get("retag_visual") or "",
                        "subjects": row.get("retag_subjects") or "",
                        "actions": row.get("retag_actions") or "",
                    },
                }
            )
    out = Path(args.feedback_out)
    append_jsonl(out, rows)
    print(f"Imported feedback rows: {len(rows)}")
    print(f"Feedback JSONL: {out}")


def feedback_matches_candidate(entry: dict, candidate: dict, tolerance: float) -> bool:
    scope = clean(entry.get("scope") or "exact_segment").lower()
    if scope in {"asset_file", "file", "basename"}:
        target = basename(entry.get("asset_file") or entry.get("mp4_path"))
        return bool(target) and target == basename(candidate.get("file") or candidate.get("mp4_path"))
    if scope in {"segment_id", "visual_segment"}:
        return bool(entry.get("segment_id")) and str(entry.get("segment_id")) == str(candidate.get("segment_id"))
    if scope in {"exact_segment", "exact_clip", "clip"}:
        if entry.get("segment_id") and candidate.get("segment_id"):
            if str(entry.get("segment_id")) == str(candidate.get("segment_id")):
                return True
        target_base = basename(entry.get("asset_file") or entry.get("mp4_path"))
        cand_base = basename(candidate.get("file") or candidate.get("mp4_path"))
        if not target_base or target_base != cand_base:
            return False
        try:
            start = float(entry.get("start"))
            end = float(entry.get("end"))
            cand_start = float(candidate.get("start") or 0.0)
            cand_end = float(candidate.get("end") or 0.0)
        except (TypeError, ValueError):
            return False
        return abs(start - cand_start) <= tolerance and abs(end - cand_end) <= tolerance
    return False


def apply_retag(candidate: dict, entry: dict) -> None:
    retag = entry.get("retag") or {}
    if retag.get("visual"):
        candidate["human_visual_one_line"] = retag["visual"]
    if retag.get("subjects"):
        candidate["human_subjects"] = retag["subjects"]
    if retag.get("actions"):
        candidate["human_actions"] = retag["actions"]


def annotate_candidate(candidate: dict, feedback: list[dict], tolerance: float) -> list[dict]:
    matched = [entry for entry in feedback if feedback_matches_candidate(entry, candidate, tolerance)]
    if not matched:
        return []
    notes = []
    for entry in matched:
        verdict = clean(entry.get("verdict")).lower()
        note = {
            "verdict": verdict,
            "scope": entry.get("scope"),
            "reason": entry.get("reason"),
            "created_at": entry.get("created_at"),
        }
        notes.append(note)
        if verdict == "reject":
            candidate["feedback_rejected"] = True
        elif verdict == "penalize":
            candidate["feedback_penalty"] = max(float(candidate.get("feedback_penalty") or 0.0), 0.15)
        elif verdict == "prefer":
            candidate["feedback_preferred"] = True
        elif verdict == "retag":
            apply_retag(candidate, entry)
    candidate["human_feedback"] = notes
    return notes


def repick_candidate(record: dict) -> dict | None:
    for candidate in record.get("candidates_top_segments") or []:
        if candidate.get("feedback_rejected"):
            continue
        return candidate
    return None


def apply_feedback(args: argparse.Namespace) -> None:
    matches = read_json(Path(args.matches))
    feedback = load_jsonl(Path(args.feedback))
    rejected_records = 0
    annotated_candidates = 0
    repicked = 0
    for record in iter_records(matches):
        candidates = record.get("candidates_top_segments") or []
        for candidate in candidates:
            if annotate_candidate(candidate, feedback, args.tolerance):
                annotated_candidates += 1
        picked = record.get("picked")
        if picked:
            notes = annotate_candidate(picked, feedback, args.tolerance)
            if notes:
                annotated_candidates += 1
            if picked.get("feedback_rejected"):
                previous = picked
                record["picked"] = None
                record["rejected_picked"] = previous
                record["accepted"] = False
                record["pick"] = 0
                record["reject_reason"] = "rejected by human asset feedback"
                record["rerank_reason"] = clean(record.get("rerank_reason")) + " | human feedback rejected picked asset"
                rejected_records += 1
                if args.repick:
                    next_candidate = repick_candidate(record)
                    if next_candidate:
                        record["picked"] = next_candidate
                        record["accepted"] = True
                        record["pick"] = int(next_candidate.get("rank") or 1)
                        record["raw_pick"] = int(next_candidate.get("rank") or 1)
                        record["fit_score"] = float(next_candidate.get("cosine") or 0.0)
                        record["match_type"] = record.get("match_type") or "same_visual_process"
                        record["reject_reason"] = ""
                        record["rerank_reason"] = "repicked by candidate rank after human feedback rejection"
                        repicked += 1
        if args.drop_rejected_candidates and candidates:
            record["candidates_top_segments"] = [
                candidate for candidate in candidates if not candidate.get("feedback_rejected")
            ]
    matches["n_picked"] = sum(1 for record in iter_records(matches) if record.get("accepted") and record.get("picked"))
    params = matches.setdefault("params", {})
    params["asset_feedback"] = {
        "feedback": str(Path(args.feedback)),
        "entries": len(feedback),
        "rejected_records": rejected_records,
        "annotated_candidates": annotated_candidates,
        "repicked": repicked,
    }
    write_json(Path(args.out), matches)
    print(f"Applied feedback: {args.feedback}")
    print(f"Annotated candidates: {annotated_candidates}")
    print(f"Rejected picked records: {rejected_records}")
    print(f"Repicked records: {repicked}")
    print(f"Saved: {args.out}")


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    ex = sub.add_parser("export-review")
    ex.add_argument("--matches", required=True)
    ex.add_argument("--out", required=True)
    ex.add_argument("--accepted-only", action="store_true", default=True)
    ex.add_argument("--top-candidates", type=int, default=3)
    ex.set_defaults(func=export_review)

    im = sub.add_parser("import-review")
    im.add_argument("--csv", required=True)
    im.add_argument("--feedback-out", default=str(DEFAULT_FEEDBACK))
    im.set_defaults(func=import_review)

    apf = sub.add_parser("apply")
    apf.add_argument("--matches", required=True)
    apf.add_argument("--feedback", default=str(DEFAULT_FEEDBACK))
    apf.add_argument("--out", required=True)
    apf.add_argument("--tolerance", type=float, default=0.08)
    apf.add_argument("--repick", action="store_true")
    apf.add_argument("--drop-rejected-candidates", action="store_true")
    apf.set_defaults(func=apply_feedback)
    return ap.parse_args()


def main() -> None:
    args = parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
