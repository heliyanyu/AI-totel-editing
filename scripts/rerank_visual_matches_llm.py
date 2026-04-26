# -*- coding: utf-8 -*-
"""Rerank visual match candidates with the production LLM API."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from rerank_visual_matches_codex import (
    ALL_MATCH_TYPES,
    DEFAULT_ACCEPTED_MATCH_TYPES,
    basename,
    build_prompt,
    candidate_keys,
    parse_csv_set,
    read_json,
    record_id,
    reject_reason,
    write_json,
)

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parent


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser()
    ap.add_argument("--matches", required=True, help="RAG matches JSON with candidates_top_segments")
    ap.add_argument("--out", required=True, help="Output matches JSON after LLM rerank")
    ap.add_argument("--provider", default="anthropic", choices=["anthropic", "openai"])
    ap.add_argument("--model", default="claude-sonnet-4-6")
    ap.add_argument("--top-candidates", type=int, default=12)
    ap.add_argument("--batch-size", type=int, default=3)
    ap.add_argument("--concurrency", type=int, default=2)
    ap.add_argument("--timeout", type=int, default=360)
    ap.add_argument("--max-tokens", type=int, default=4096)
    ap.add_argument("--min-fit-score", type=float, default=0.72)
    ap.add_argument("--min-cosine", type=float, default=0.0)
    ap.add_argument("--accepted-match-types", default=",".join(sorted(DEFAULT_ACCEPTED_MATCH_TYPES)))
    ap.add_argument("--max-exact-reuse", type=int, default=1)
    ap.add_argument("--max-file-reuse", type=int, default=3)
    ap.add_argument("--max-basename-reuse", type=int, default=3)
    ap.add_argument("--logs-dir", default=str(REPO_ROOT / "local_artifacts" / "logs" / "llm_rerank_visual_matches"))
    return ap.parse_args()


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


def clean_text(value: Any, limit: int = 500) -> str:
    text = str(value or "").replace("\r", " ").replace("\n", " ").strip()
    return text if len(text) <= limit else text[: limit - 3] + "..."


def normalize_base_url(value: str) -> str:
    return str(value or "").rstrip("/")


def anthropic_openai_compat_base_url() -> str:
    return normalize_base_url(
        os.environ.get("ANTHROPIC_OPENAI_BASE_URL")
        or os.environ.get("ANTHROPIC_COMPAT_BASE_URL")
        or ""
    )


def extract_openai_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                if isinstance(item.get("text"), str):
                    parts.append(item["text"])
                elif isinstance(item.get("content"), str):
                    parts.append(item["content"])
        return "".join(parts)
    return str(content or "")


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
    import re

    match = re.search(r"(\{.*\}|\[.*\])", raw, re.S)
    if not match:
        raise ValueError(f"no JSON found in LLM output: {raw[:240]}")
    return json.loads(match.group(1))


def call_openai_compatible(
    *,
    api_key: str,
    base_url: str,
    model: str,
    prompt: str,
    max_tokens: int,
    timeout: int,
) -> str:
    from openai import OpenAI

    client = OpenAI(api_key=api_key, base_url=base_url, timeout=float(timeout))
    response = client.chat.completions.create(
        model=model,
        max_tokens=max_tokens,
        messages=[
            {"role": "system", "content": "Return strict JSON only."},
            {"role": "user", "content": prompt},
        ],
    )
    if response.usage:
        print(
            f"    token: input={response.usage.prompt_tokens or 0}, "
            f"output={response.usage.completion_tokens or 0}",
            flush=True,
        )
    return extract_openai_text(response.choices[0].message.content)


def anthropic_messages_url(base_url: str) -> str:
    base = normalize_base_url(base_url)
    if base.endswith("/v1"):
        return f"{base}/messages"
    if "api.anthropic.com" in base and not base.endswith("/messages"):
        return f"{base}/v1/messages"
    return base


def call_anthropic_messages(
    *,
    api_key: str,
    base_url: str,
    model: str,
    prompt: str,
    max_tokens: int,
    timeout: int,
) -> str:
    payload = {
        "model": model,
        "max_tokens": max_tokens,
        "system": "Return strict JSON only.",
        "messages": [{"role": "user", "content": prompt}],
    }
    request = urllib.request.Request(
        anthropic_messages_url(base_url),
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Anthropic API error {exc.code}: {body[:500]}") from exc

    data = json.loads(raw)
    usage = data.get("usage") or {}
    if usage:
        print(
            f"    token: input={usage.get('input_tokens', 0)}, "
            f"output={usage.get('output_tokens', 0)}",
            flush=True,
        )
    content = data.get("content") or []
    if isinstance(content, list):
        return "".join(block.get("text", "") for block in content if isinstance(block, dict))
    return str(content or "")


def call_llm_json(prompt: str, args: argparse.Namespace) -> Any:
    if args.provider == "openai":
        api_key = os.environ.get("OPENAI_API_KEY") or os.environ.get("ARK_API_KEY")
        base_url = os.environ.get("OPENAI_BASE_URL") or os.environ.get("ARK_BASE_URL")
        if not api_key or not base_url:
            raise RuntimeError("OPENAI_API_KEY and OPENAI_BASE_URL are required for openai provider")
        raw = call_openai_compatible(
            api_key=api_key,
            base_url=normalize_base_url(base_url),
            model=args.model,
            prompt=prompt,
            max_tokens=args.max_tokens,
            timeout=args.timeout,
        )
    else:
        compat_base_url = anthropic_openai_compat_base_url()
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY is required for anthropic provider")
        if compat_base_url:
            raw = call_openai_compatible(
                api_key=api_key,
                base_url=compat_base_url,
                model=args.model,
                prompt=prompt,
                max_tokens=args.max_tokens,
                timeout=args.timeout,
            )
        else:
            base_url = os.environ.get("ANTHROPIC_BASE_URL") or "https://api.anthropic.com/v1/messages"
            raw = call_anthropic_messages(
                api_key=api_key,
                base_url=base_url,
                model=args.model,
                prompt=prompt,
                max_tokens=args.max_tokens,
                timeout=args.timeout,
            )
    return parse_jsonish(raw)


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
        return default_rerank(seg_id, "LLM returned no result")
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


def run_llm_batch(
    batch_idx: int,
    batch: list[dict],
    args: argparse.Namespace,
    logs_dir: Path,
) -> dict[str, dict]:
    prompt = build_prompt(batch, args.top_candidates)
    prompt_path = logs_dir / f"batch_{batch_idx:03d}_prompt.txt"
    raw_path = logs_dir / f"batch_{batch_idx:03d}_raw.txt"
    prompt_path.write_text(prompt, encoding="utf-8")
    started = time.time()
    try:
        parsed = call_llm_json(prompt, args)
        raw_path.write_text(json.dumps(parsed, ensure_ascii=False, indent=2), encoding="utf-8")
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
        raw_path.write_text(f"batch failed after {elapsed:.1f}s: {exc}\n", encoding="utf-8")
        print(f"  batch {batch_idx:03d}: failed after {elapsed:.1f}s: {exc}", flush=True)
        return {
            record_id(record): default_rerank(
                record_id(record),
                f"LLM rerank error: {exc}",
            )
            for record in batch
        }


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
            rr = rr_by_seg.get(seg_id, default_rerank(seg_id, "missing LLM rerank"))

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
        record["llm_rerank"] = {
            "provider": args.provider,
            "model": args.model,
            "top_candidates": args.top_candidates,
            **rr,
        }

    data["algo"] = f"{data.get('algo', 'visual-atom-rag')} + llm-api-rerank"
    data["n_picked"] = accepted
    params = data.setdefault("params", {})
    params["llm_rerank"] = {
        "provider": args.provider,
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
    load_env_file()
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
    print(f"LLM rerank: {args.provider}:{args.model}; concurrency={args.concurrency}; logs={logs_dir}")

    rr_by_seg: dict[str, dict] = {}
    if batches:
        with ThreadPoolExecutor(max_workers=max(1, args.concurrency)) as executor:
            futures = {
                executor.submit(run_llm_batch, idx + 1, batch, args, logs_dir): idx
                for idx, batch in enumerate(batches)
            }
            done = 0
            for future in as_completed(futures):
                rr_by_seg.update(future.result())
                done += 1
                print(f"  progress: {done}/{len(batches)} batches", flush=True)

    data = apply_reranks(data, rr_by_seg, args)
    write_json(out_path, data)

    print(f"Saved LLM-reranked matches: {out_path}")
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
