#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Use Codex CLI + GPT-5.4 to segment Whisper word streams into atom/logic/scene.

Compared with the earlier marker-copy flow, this version asks the model to
return word-index ranges. That avoids copy drift on long transcripts while
still preserving exact word-level timestamps.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

sys.stdout.reconfigure(encoding="utf-8")

INPUT_DIR = Path(r"E:\nucleus download\whisper_output")
OUTPUT_DIR = Path(r"E:\nucleus download\asset_segments")
DEFAULT_WORKDIR = Path(r"F:\AI total editing\editing V1")

PROMPT_TEMPLATE = """将下面多个文件的 indexed_words 切成三级语义结构 atom / logic / scene，并只返回 files。

硬性规则：
- 对每个文件分别返回 atoms
- 使用 1-based end_word / boundary
- 每个文件的 atoms 必须完整覆盖该文件全部词，不能重叠，不能遗漏
- 每个文件默认从第 1 个词开始，后一个 atom 自动从前一个 atom 的 end_word + 1 开始
- 每个文件的第一个 atom boundary 必须是 scene
- boundary 只能是 scene / logic / null
- atom 必须细切成短词组或很短分句；英文通常 1 到 5 个词
- 不要拆固定搭配、术语、专有名词、数量短语
- 如果拿不准边界，就少切，不要遗漏或乱序

示例：
A coronary angioplasty procedure is also known as percutaneous coronary intervention.
=> [{{"end_word": 4, "boundary": "scene"}}, {{"end_word": 8, "boundary": null}}, {{"end_word": 11, "boundary": null}}]

以下每个 FILE 独立处理：

{files_block}
"""

RATE_LIMIT_MARKERS = (
    "hit your limit",
    "rate limit",
    "too many requests",
    "status 429",
    "error 429",
    "code 429",
    "429 too many requests",
    "quota",
)


class RateLimitError(RuntimeError):
    pass


class BatchCallError(RuntimeError):
    pass


@dataclass
class LoadedFile:
    filename: str
    data: dict[str, Any]
    words: list[dict[str, Any]]
    language: str
    indexed_words: str


def build_schema(batch_size: int) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "files": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "index": {"type": "integer", "minimum": 1},
                        "atoms": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "end_word": {"type": "integer", "minimum": 1},
                                    "boundary": {
                                        "type": ["string", "null"],
                                        "enum": ["scene", "logic", None],
                                    },
                                },
                                "required": ["end_word", "boundary"],
                                "additionalProperties": False,
                            },
                        },
                    },
                    "required": ["index", "atoms"],
                    "additionalProperties": False,
                },
                "minItems": batch_size,
                "maxItems": batch_size,
            }
        },
        "required": ["files"],
        "additionalProperties": False,
    }


def build_prompt(batch: list[LoadedFile]) -> str:
    parts: list[str] = []
    for index, item in enumerate(batch, start=1):
        parts.append(
            f"FILE {index}\n"
            f"language: {item.language}\n"
            f"n_words: {len(item.words)}\n"
            f"indexed_words:\n{item.indexed_words}"
        )
    return PROMPT_TEMPLATE.format(files_block="\n\n".join(parts))


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def load_file(path: Path) -> tuple[LoadedFile | None, dict[str, Any] | None]:
    try:
        data = json.loads(read_text(path))
    except Exception as exc:
        return None, {"skipped": True, "reason": "load error", "error": str(exc)[:300]}

    segments = data.get("segments", [])
    if not segments:
        return None, {"skipped": True, "reason": "no segments"}

    words = [
        word
        for segment in segments
        for word in segment.get("words", [])
        if word.get("word", "").strip()
    ]
    if not words:
        return None, {"skipped": True, "reason": "no words"}
    if len(words) < 5:
        return None, {"skipped": True, "reason": "too short"}

    indexed_words = " | ".join(
        f"{idx}:{word['word'].strip()}" for idx, word in enumerate(words, start=1)
    )
    return (
        LoadedFile(
            filename=path.name,
            data=data,
            words=words,
            language=data.get("language", "unknown"),
            indexed_words=indexed_words,
        ),
        None,
    )


def extract_log_excerpt(text: str) -> str:
    text = text.strip()
    if not text:
        return ""
    lines = [line for line in text.splitlines() if line.strip()]
    if not lines:
        return ""
    excerpt = "\n".join(lines[-20:])
    return excerpt[:4000]


def maybe_raise_rate_limit(text: str) -> None:
    lowered = text.lower()
    if any(marker in lowered for marker in RATE_LIMIT_MARKERS):
        raise RateLimitError(extract_log_excerpt(text) or "rate limit detected")


def run_codex(prompt: str, batch_size: int, model: str, workdir: Path, timeout_s: int) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="codex_segment_") as tmpdir:
        tmpdir_path = Path(tmpdir)
        schema_path = tmpdir_path / "schema.json"
        out_path = tmpdir_path / "out.json"
        log_path = tmpdir_path / "codex.log"
        schema_path.write_text(
            json.dumps(build_schema(batch_size), ensure_ascii=False),
            encoding="utf-8",
        )

        cmd = [
            "codex",
            "exec",
            "-m",
            model,
            "-c",
            'model_reasoning_effort="low"',
            "--disable",
            "plugins",
            "--disable",
            "general_analytics",
            "--disable",
            "shell_snapshot",
            "--sandbox",
            "read-only",
            "--skip-git-repo-check",
            "--color",
            "never",
            "--output-schema",
            str(schema_path),
            "-o",
            str(out_path),
            "-",
        ]

        with log_path.open("w", encoding="utf-8") as log_file:
            proc = subprocess.run(
                cmd,
                input=prompt,
                text=True,
                encoding="utf-8",
                cwd=workdir,
                stdout=log_file,
                stderr=subprocess.STDOUT,
                timeout=timeout_s,
            )

        log_text = read_text(log_path)
        maybe_raise_rate_limit(log_text)

        if proc.returncode != 0:
            raise BatchCallError(
                f"codex exit code {proc.returncode}: {extract_log_excerpt(log_text)}"
            )

        if not out_path.exists():
            raise BatchCallError(
                f"codex produced no output file: {extract_log_excerpt(log_text)}"
            )

        out_text = read_text(out_path)
        maybe_raise_rate_limit(out_text)
        try:
            return json.loads(out_text)
        except Exception as exc:
            raise BatchCallError(
                f"invalid JSON from codex: {str(exc)} | {out_text[:800]}"
            ) from exc


def validate_ranges(range_items: list[dict[str, Any]], n_words: int) -> tuple[bool, str]:
    if not range_items:
        return False, "no atoms returned"
    if range_items[0].get("boundary") != "scene":
        return False, "first atom boundary is not scene"

    cursor = 1
    for idx, atom in enumerate(range_items):
        end_word = atom.get("end_word")
        if not isinstance(end_word, int):
            return False, f"atom {idx} end_word is not int"
        if end_word < cursor:
            return False, f"atom {idx} end_word {end_word} < start {cursor}"
        cursor = end_word + 1

    if cursor != n_words + 1:
        return False, f"coverage ended at {cursor - 1}, expected {n_words}"
    return True, ""


def words_to_text(words: list[dict[str, Any]], start_idx: int, end_idx: int) -> str:
    return " ".join(words[i]["word"].strip() for i in range(start_idx, end_idx + 1))


def build_atoms_from_ranges(
    words: list[dict[str, Any]], range_items: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    atoms: list[dict[str, Any]] = []
    start_word = 1
    for item in range_items:
        end_word = int(item["end_word"])
        boundary = item.get("boundary")
        start_idx = start_word - 1
        end_idx = end_word - 1
        atoms.append(
            {
                "text": words_to_text(words, start_idx, end_idx),
                "start": round(words[start_idx]["start"], 2),
                "end": round(words[end_idx]["end"], 2),
                "boundary": boundary,
            }
        )
        start_word = end_word + 1
    return atoms


def build_logic_blocks(atoms: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not atoms:
        return []

    blocks: list[dict[str, Any]] = []
    current = [atoms[0]]
    scene_start_time = atoms[0]["start"]

    for atom in atoms[1:]:
        if atom["boundary"] in ("scene", "logic"):
            blocks.append(
                {
                    "start": current[0]["start"],
                    "end": current[-1]["end"],
                    "text": " ".join(piece["text"] for piece in current),
                    "scene_start": scene_start_time,
                    "n_atoms": len(current),
                }
            )
            current = []
            if atom["boundary"] == "scene":
                scene_start_time = atom["start"]
        current.append(atom)

    if current:
        blocks.append(
            {
                "start": current[0]["start"],
                "end": current[-1]["end"],
                "text": " ".join(piece["text"] for piece in current),
                "scene_start": scene_start_time,
                "n_atoms": len(current),
            }
        )

    return blocks


def materialize_result(loaded: LoadedFile, range_items: list[dict[str, Any]]) -> dict[str, Any]:
    atoms = build_atoms_from_ranges(loaded.words, range_items)
    return {
        "file": loaded.data.get("file", ""),
        "language": loaded.language,
        "atoms": atoms,
        "logic_blocks": build_logic_blocks(atoms),
    }


def write_result(filename: str, result: dict[str, Any]) -> None:
    out_path = OUTPUT_DIR / filename
    out_path.write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def process_single_file(
    loaded: LoadedFile,
    model: str,
    workdir: Path,
    max_attempts: int,
    timeout_s: int,
) -> dict[str, Any]:
    last_error = ""
    for attempt in range(1, max_attempts + 1):
        try:
            payload = run_codex(
                build_prompt([loaded]),
                1,
                model=model,
                workdir=workdir,
                timeout_s=timeout_s,
            )
            files = payload.get("files", [])
            if len(files) != 1:
                raise BatchCallError(f"expected 1 file, got {len(files)}")
            range_items = files[0].get("atoms", [])
            valid, error = validate_ranges(range_items, len(loaded.words))
            if valid:
                return materialize_result(loaded, range_items)
            last_error = error
        except RateLimitError:
            raise
        except Exception as exc:
            last_error = str(exc)[:400]
        if attempt < max_attempts:
            time.sleep(1)

    return {
        "skipped": True,
        "reason": "verify failed",
        "error": last_error or "unknown range validation error",
    }


def process_batch(
    batch: list[LoadedFile],
    model: str,
    workdir: Path,
    max_attempts: int,
    timeout_s: int,
) -> list[tuple[str, dict[str, Any]]]:
    if len(batch) == 1:
        return [(batch[0].filename, process_single_file(batch[0], model, workdir, max_attempts, timeout_s))]

    by_index = {idx: item for idx, item in enumerate(batch, start=1)}
    last_batch_error = ""

    for attempt in range(1, max_attempts + 1):
        try:
            payload = run_codex(
                build_prompt(batch),
                len(batch),
                model=model,
                workdir=workdir,
                timeout_s=timeout_s,
            )
            files = payload.get("files", [])
            if len(files) != len(batch):
                raise BatchCallError(f"expected {len(batch)} files, got {len(files)}")

            raw_results: dict[str, dict[str, Any]] = {}
            failed: list[LoadedFile] = []

            seen_indexes: set[int] = set()
            for file_result in files:
                index = file_result.get("index")
                if index not in by_index or index in seen_indexes:
                    raise BatchCallError(f"unexpected file index {index}")
                seen_indexes.add(index)
                loaded = by_index[index]
                range_items = file_result.get("atoms", [])
                valid, error = validate_ranges(range_items, len(loaded.words))
                if valid:
                    raw_results[loaded.filename] = materialize_result(loaded, range_items)
                else:
                    failed.append(loaded)
                    raw_results[loaded.filename] = {
                        "skipped": True,
                        "reason": "verify failed",
                        "error": error,
                    }

            if len(seen_indexes) != len(batch):
                raise BatchCallError("missing files in batch response")

            if not failed:
                return [(item.filename, raw_results[item.filename]) for item in batch]

            fixed_results = raw_results.copy()
            for loaded in failed:
                fixed_results[loaded.filename] = process_single_file(
                    loaded, model, workdir, max_attempts, timeout_s
                )
            return [(item.filename, fixed_results[item.filename]) for item in batch]

        except RateLimitError:
            raise
        except Exception as exc:
            last_batch_error = str(exc)[:500]
            if attempt < max_attempts:
                time.sleep(1)

    return [
        (
            loaded.filename,
            process_single_file(loaded, model, workdir, max_attempts, timeout_s)
            if len(batch) > 1
            else {
                "skipped": True,
                "reason": "verify failed",
                "error": last_batch_error or "batch failure",
            },
        )
        for loaded in batch
    ]


def iter_todo_files(shard: int, total_shards: int) -> list[Path]:
    all_files = sorted(path for path in INPUT_DIR.glob("*.json"))
    if total_shards > 1:
        all_files = [
            path for idx, path in enumerate(all_files) if idx % total_shards == shard
        ]
    done = {path.name for path in OUTPUT_DIR.glob("*.json")}
    return [path for path in all_files if path.name not in done]


def should_stop(stop_file: Path | None) -> bool:
    return bool(stop_file and stop_file.exists())


def batch_timeout_seconds(batch: list[LoadedFile], base_timeout: int) -> int:
    total_words = sum(len(item.words) for item in batch)
    extra = math.ceil(total_words / 25)
    return max(base_timeout, extra)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="gpt-5.4")
    parser.add_argument("--batch-word-limit", type=int, default=900)
    parser.add_argument("--batch-file-limit", type=int, default=2)
    parser.add_argument("--max-attempts", type=int, default=2)
    parser.add_argument("--timeout-seconds", type=int, default=180)
    parser.add_argument("--shard", type=int, default=0)
    parser.add_argument("--total-shards", type=int, default=1)
    parser.add_argument("--stop-file", default="")
    parser.add_argument("--workdir", default=str(DEFAULT_WORKDIR))
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--only", nargs="*", default=[])
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    stop_file = Path(args.stop_file) if args.stop_file else None
    workdir = Path(args.workdir)

    if args.only:
        todo = [INPUT_DIR / name for name in args.only]
    else:
        todo = iter_todo_files(args.shard, args.total_shards)
    if args.limit > 0:
        todo = todo[: args.limit]

    print(
        f"Shard {args.shard}/{args.total_shards} | to process: {len(todo)} | "
        f"batch_word_limit={args.batch_word_limit} batch_file_limit={args.batch_file_limit}"
    )

    files_ok = 0
    files_skipped = 0
    files_failed = 0
    batches_run = 0
    started_at = time.time()
    pending: list[LoadedFile] = []
    pending_words = 0

    def flush_pending() -> None:
        nonlocal pending, pending_words, batches_run, files_ok, files_skipped, files_failed
        if not pending:
            return
        batch = pending
        pending = []
        pending_words = 0
        batches_run += 1
        batch_started = time.time()
        try:
            results = process_batch(
                batch,
                model=args.model,
                workdir=workdir,
                max_attempts=args.max_attempts,
                timeout_s=batch_timeout_seconds(batch, args.timeout_seconds),
            )
        except RateLimitError as exc:
            if stop_file:
                stop_file.write_text(
                    f"rate limit hit at {time.strftime('%Y-%m-%d %H:%M:%S')}\n{str(exc)}\n",
                    encoding="utf-8",
                )
            raise

        for filename, result in results:
            write_result(filename, result)
            if result.get("skipped"):
                if result.get("reason") == "too short":
                    files_skipped += 1
                else:
                    files_failed += 1
            else:
                files_ok += 1

        elapsed = time.time() - started_at
        batch_elapsed = time.time() - batch_started
        total_done = files_ok + files_skipped + files_failed
        rate = total_done / elapsed * 3600 if elapsed > 0 else 0
        batch_names = ", ".join(item.filename for item in batch[:3])
        if len(batch) > 3:
            batch_names += ", ..."
        print(
            f"batch {batches_run}: {len(batch)} files / {sum(len(item.words) for item in batch)} words "
            f"in {batch_elapsed:.1f}s | ok:{files_ok} fail:{files_failed} skip:{files_skipped} "
            f"| {rate:.1f} files/hr | {batch_names}"
        )

    try:
        for idx, path in enumerate(todo, start=1):
            if should_stop(stop_file):
                print(f"Stop file detected: {stop_file}")
                break

            loaded, immediate_result = load_file(path)
            if immediate_result is not None:
                write_result(path.name, immediate_result)
                if immediate_result.get("reason") == "too short":
                    files_skipped += 1
                else:
                    files_failed += 1
                continue

            assert loaded is not None
            would_exceed = (
                pending
                and (
                    pending_words + len(loaded.words) > args.batch_word_limit
                    or len(pending) >= args.batch_file_limit
                )
            )
            if would_exceed:
                flush_pending()
                if should_stop(stop_file):
                    print(f"Stop file detected after flush: {stop_file}")
                    break

            pending.append(loaded)
            pending_words += len(loaded.words)

        flush_pending()
    except RateLimitError as exc:
        print(f"RATE LIMIT HIT: {exc}")
        raise SystemExit(2)

    total_elapsed = time.time() - started_at
    print(
        f"Done in {total_elapsed/60:.1f} min | ok:{files_ok} skipped:{files_skipped} "
        f"failed:{files_failed} batches:{batches_run}"
    )


if __name__ == "__main__":
    main()
