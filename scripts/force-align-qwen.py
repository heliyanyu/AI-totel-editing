#!/usr/bin/env python
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Sequence, Tuple

import numpy as np


def eprint(message: str) -> None:
    print(message, file=sys.stderr)


def round3(value: float) -> float:
    return round(float(value), 3)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run Qwen3-ForcedAligner on reviewed tokens and emit aligned token transcripts."
    )
    parser.add_argument("--audio", required=True, help="Path to the source audio/video file.")
    parser.add_argument(
        "--transcript",
        required=True,
        help="Path to reviewed_tokens.json or a legacy transcript JSON.",
    )
    parser.add_argument("--output-dir", required=True, help="Directory to write aligned outputs.")
    parser.add_argument(
        "--model",
        default="Qwen/Qwen3-ForcedAligner-0.6B",
        help="Qwen3-ForcedAligner checkpoint repo id or local directory.",
    )
    parser.add_argument(
        "--language",
        default="Chinese",
        help='Alignment language name understood by qwen-asr, e.g. "Chinese", "English".',
    )
    parser.add_argument(
        "--device-map",
        default="cuda:0",
        help='Transformers device_map, e.g. "cuda:0" or "cpu".',
    )
    parser.add_argument(
        "--dtype",
        choices=("bfloat16", "float16", "float32"),
        default="bfloat16",
        help="Torch dtype used when loading the aligner model.",
    )
    parser.add_argument(
        "--max-chunk-seconds",
        type=float,
        default=240.0,
        help="Maximum spoken duration per forced-alignment chunk.",
    )
    parser.add_argument(
        "--min-chunk-seconds",
        type=float,
        default=25.0,
        help="Minimum chunk duration before a silence gap is allowed to split.",
    )
    parser.add_argument(
        "--gap-threshold-seconds",
        type=float,
        default=0.75,
        help="Gap threshold that can trigger a chunk split once min duration is met.",
    )
    parser.add_argument(
        "--padding-seconds",
        type=float,
        default=0.8,
        help="Context padding added on both sides when extracting chunk audio.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=4,
        help="Batch size passed to the forced aligner.",
    )
    return parser.parse_args()


def ensure_ffmpeg() -> None:
    try:
        subprocess.run(
            ["ffmpeg", "-version"],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception as exc:  # pragma: no cover - environment specific
        raise RuntimeError("ffmpeg 不可用，请先安装 ffmpeg 并确保在 PATH 中。") from exc


def load_json(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


@dataclass(frozen=True)
class SourceToken:
    id: int
    text: str
    start: float
    end: float
    raw_word_indices: List[int]
    synthetic: bool = False


@dataclass(frozen=True)
class ChunkPlan:
    index: int
    start_word_index: int
    end_word_index: int
    content_start: float
    content_end: float
    audio_start: float
    audio_end: float
    word_count: int

    @property
    def preview(self) -> str:
        return f"{self.start_word_index}-{self.end_word_index}"


def normalize_language_name(language: str) -> str:
    normalized = language.strip().lower()
    mapping = {
        "zh": "Chinese",
        "zh-cn": "Chinese",
        "zh-hans": "Chinese",
        "zh-hant": "Chinese",
        "en": "English",
        "yue": "Cantonese",
        "ja": "Japanese",
        "ko": "Korean",
        "de": "German",
        "fr": "French",
        "es": "Spanish",
        "it": "Italian",
        "pt": "Portuguese",
        "ru": "Russian",
    }
    return mapping.get(normalized, language)


def parse_source_tokens(payload: Dict[str, Any]) -> List[SourceToken]:
    source_tokens: List[SourceToken] = []

    if isinstance(payload.get("tokens"), list):
        for index, token in enumerate(payload.get("tokens", [])):
            token_id = int(token.get("id", index))
            start = float(token.get("source_start", 0))
            end = float(token.get("source_end", start))
            if end < start:
                start, end = end, start
            source_tokens.append(
                SourceToken(
                    id=token_id,
                    text=str(token.get("text", "")),
                    start=round3(start),
                    end=round3(end),
                    raw_word_indices=[int(value) for value in token.get("raw_word_indices", [])],
                    synthetic=bool(token.get("synthetic", False)),
                )
            )
        return source_tokens

    for index, word in enumerate(payload.get("words", [])):
        start = float(word["start"])
        end = float(word["end"])
        if end < start:
            start, end = end, start
        source_tokens.append(
            SourceToken(
                id=index,
                text=str(word.get("text", "")),
                start=round3(start),
                end=round3(end),
                raw_word_indices=[index],
                synthetic=bool(word.get("synthetic", False)),
            )
        )
    return source_tokens


def build_chunk_plans(
    words: Sequence[SourceToken],
    total_duration: float,
    max_chunk_seconds: float,
    min_chunk_seconds: float,
    gap_threshold_seconds: float,
    padding_seconds: float,
) -> List[ChunkPlan]:
    if not words:
        return []

    chunks: List[ChunkPlan] = []
    chunk_start = 0

    for index in range(1, len(words)):
        current_span = words[index - 1].end - words[chunk_start].start
        next_span = words[index].end - words[chunk_start].start
        gap = max(0.0, words[index].start - words[index - 1].end)

        should_split = False
        if next_span > max_chunk_seconds and index > chunk_start:
            should_split = True
        elif current_span >= min_chunk_seconds and gap >= gap_threshold_seconds:
            should_split = True

        if not should_split:
            continue

        chunks.append(
            finalize_chunk(
                len(chunks),
                words,
                chunk_start,
                index - 1,
                total_duration,
                padding_seconds,
            )
        )
        chunk_start = index

    chunks.append(
        finalize_chunk(
            len(chunks),
            words,
            chunk_start,
            len(words) - 1,
            total_duration,
            padding_seconds,
        )
    )
    return chunks


def finalize_chunk(
    chunk_index: int,
    words: Sequence[SourceToken],
    start_word_index: int,
    end_word_index: int,
    total_duration: float,
    padding_seconds: float,
) -> ChunkPlan:
    content_start = words[start_word_index].start
    content_end = words[end_word_index].end
    audio_start = max(0.0, content_start - padding_seconds)
    audio_end = min(total_duration, content_end + padding_seconds)
    return ChunkPlan(
        index=chunk_index,
        start_word_index=start_word_index,
        end_word_index=end_word_index,
        content_start=round3(content_start),
        content_end=round3(content_end),
        audio_start=round3(audio_start),
        audio_end=round3(audio_end),
        word_count=end_word_index - start_word_index + 1,
    )


def extract_audio_slice(
    audio_path: str,
    start_time: float,
    end_time: float,
) -> Tuple[np.ndarray, int]:
    duration = max(0.0, end_time - start_time)
    args = [
        "ffmpeg",
        "-v",
        "error",
        "-ss",
        f"{start_time:.3f}",
        "-i",
        audio_path,
        "-t",
        f"{duration:.3f}",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "f32le",
        "-",
    ]
    process = subprocess.run(
        args,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    samples = np.frombuffer(process.stdout, dtype=np.float32).copy()
    return samples, 16000


def build_token_plan_for_chunk(
    aligner: Any,
    source_tokens: Sequence[SourceToken],
    language: str,
) -> Tuple[str, List[List[str]], List[str], List[int]]:
    token_units: List[List[str]] = []
    flat_units: List[str] = []
    flat_token_ids: List[int] = []
    text_parts: List[str] = []

    for source_token in source_tokens:
        text = source_token.text.strip()
        if text:
            text_parts.append(text)
        units, _ = aligner.aligner_processor.encode_timestamp(source_token.text, language)
        token_units.append(list(units))
        flat_units.extend(units)
        flat_token_ids.extend([source_token.id] * len(units))

    chunk_text = " ".join(text_parts)
    if chunk_text:
        combined_units, _ = aligner.aligner_processor.encode_timestamp(chunk_text, language)
        if list(combined_units) != flat_units:
            raise RuntimeError(
                "Qwen3-ForcedAligner tokenization mismatch between per-token and chunk-level encoding."
            )
    return chunk_text, token_units, flat_units, flat_token_ids


def build_aligned_token_entry(
    *,
    source_token: SourceToken,
    aligned_items: Sequence[Any] | None,
    chunk_audio_start: float | None = None,
) -> Dict[str, Any]:
    if aligned_items and chunk_audio_start is not None:
        start = chunk_audio_start + float(aligned_items[0].start_time)
        end = chunk_audio_start + float(aligned_items[-1].end_time)
        status = "aligned"
    else:
        start = source_token.start
        end = source_token.end
        status = "fallback"

    entry: Dict[str, Any] = {
        "id": source_token.id,
        "text": source_token.text,
        "start": round3(start),
        "end": round3(end),
        "status": status,
        "raw_word_indices": list(source_token.raw_word_indices),
        "source_start": round3(source_token.start),
        "source_end": round3(source_token.end),
    }
    if source_token.synthetic:
        entry["synthetic"] = True
    return entry


def resolve_torch_dtype(dtype_name: str) -> Any:
    import torch

    mapping = {
        "bfloat16": torch.bfloat16,
        "float16": torch.float16,
        "float32": torch.float32,
    }
    return mapping[dtype_name]


def load_aligner(model_name: str, dtype_name: str, device_map: str) -> Any:
    import torch
    from qwen_asr import Qwen3ForcedAligner

    dtype = resolve_torch_dtype(dtype_name)
    return Qwen3ForcedAligner.from_pretrained(
        model_name,
        dtype=dtype,
        device_map=device_map,
    )


def align_chunks(
    *,
    aligner: Any,
    audio_path: str,
    words: Sequence[SourceToken],
    chunks: Sequence[ChunkPlan],
    language: str,
    batch_size: int,
) -> Tuple[List[Dict[str, Any]], Dict[int, List[Dict[str, Any]]], List[Dict[str, Any]]]:
    aligned_tokens: List[Dict[str, Any]] = []
    token_groups_by_word: Dict[int, List[Dict[str, Any]]] = {}
    chunk_debug: List[Dict[str, Any]] = []

    for batch_start in range(0, len(chunks), batch_size):
        batch = list(chunks[batch_start : batch_start + batch_size])
        audio_inputs: List[Tuple[np.ndarray, int]] = []
        texts: List[str] = []
        plans: List[Tuple[ChunkPlan, Sequence[SourceToken], List[str], List[int]]] = []

        for chunk in batch:
            chunk_words = words[chunk.start_word_index : chunk.end_word_index + 1]
            chunk_text, _word_units, flat_units, flat_token_ids = build_token_plan_for_chunk(
                aligner,
                chunk_words,
                language,
            )
            preview = "".join(word.text for word in chunk_words).replace("\n", " ").strip()[:80]
            chunk_debug.append(
                {
                    "index": chunk.index,
                    "startWordIndex": chunk.start_word_index,
                    "endWordIndex": chunk.end_word_index,
                    "wordCount": chunk.word_count,
                    "alignableTokenCount": len(flat_units),
                    "audioStart": chunk.audio_start,
                    "audioEnd": chunk.audio_end,
                    "contentStart": chunk.content_start,
                    "contentEnd": chunk.content_end,
                    "preview": preview,
                }
            )
            if not flat_units:
                continue

            audio_inputs.append(extract_audio_slice(audio_path, chunk.audio_start, chunk.audio_end))
            texts.append(chunk_text)
            plans.append((chunk, chunk_words, flat_units, flat_token_ids))

        if not plans:
            continue

        eprint(
            f"[force-align] running batch {batch_start // batch_size + 1} "
            f"with {len(plans)} chunk(s)"
        )
        results = aligner.align(
            audio=audio_inputs,
            text=texts,
            language=[language] * len(texts),
        )

        for result, (chunk, chunk_words, flat_units, flat_token_ids) in zip(results, plans):
            items = list(result)
            if len(items) != len(flat_units):
                raise RuntimeError(
                    f"Chunk {chunk.index} alignment count mismatch: expected {len(flat_units)}, got {len(items)}."
                )

            grouped_items: Dict[int, List[Any]] = {}
            for item, token_id in zip(items, flat_token_ids):
                grouped_items.setdefault(token_id, []).append(item)

            for chunk_word in chunk_words:
                token_entry = build_aligned_token_entry(
                    source_token=chunk_word,
                    aligned_items=grouped_items.get(chunk_word.id, []),
                    chunk_audio_start=chunk.audio_start,
                )
                aligned_tokens.append(token_entry)
                for raw_word_index in chunk_word.raw_word_indices:
                    token_groups_by_word.setdefault(raw_word_index, []).append(token_entry)

    return aligned_tokens, token_groups_by_word, chunk_debug


def build_aligned_word_transcript(
    words: Sequence[SourceToken],
    token_groups_by_word: Dict[int, List[Dict[str, Any]]],
    duration: float,
) -> Tuple[Dict[str, Any], int]:
    aligned_words: List[Dict[str, Any]] = []
    fallback_count = 0

    for raw_word in words:
        if not raw_word.raw_word_indices:
            continue
        raw_word_index = raw_word.raw_word_indices[0]
        tokens = token_groups_by_word.get(raw_word_index, [])
        if tokens:
            start = float(tokens[0]["start"])
            end = float(tokens[-1]["end"])
            aligned_words.append({
                "text": raw_word.text,
                "start": round3(start),
                "end": round3(end),
                "source_word_indices": list(raw_word.raw_word_indices),
                "source_start": round3(raw_word.start),
                "source_end": round3(raw_word.end),
                "synthetic": raw_word.synthetic or None,
            })
            continue

        fallback_count += 1
        aligned_words.append({
            "text": raw_word.text,
            "start": round3(raw_word.start),
            "end": round3(raw_word.end),
            "source_word_indices": list(raw_word.raw_word_indices),
            "source_start": round3(raw_word.start),
            "source_end": round3(raw_word.end),
            "synthetic": True,
        })

    return {
        "duration": round3(duration),
        "words": aligned_words,
    }, fallback_count


def build_aligned_token_transcript(
    aligned_tokens: Sequence[Dict[str, Any]],
    duration: float,
) -> Dict[str, Any]:
    return {
        "duration": round3(duration),
        "tokens": list(aligned_tokens),
    }


def main() -> None:
    args = parse_args()
    ensure_ffmpeg()

    audio_path = str(Path(args.audio).resolve())
    transcript_path = Path(args.transcript).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    transcript = load_json(transcript_path)
    words = parse_source_tokens(transcript)
    duration = float(transcript.get("duration", 0) or 0)
    if duration <= 0 and words:
        duration = max(word.end for word in words)
    language = normalize_language_name(args.language)

    if args.device_map.startswith("cpu") and args.dtype != "float32":
        eprint("[force-align] cpu device_map detected, forcing dtype=float32")
        args.dtype = "float32"

    eprint(
        f"[force-align] loading model={args.model} language={language} "
        f"device_map={args.device_map} dtype={args.dtype}"
    )
    try:
        aligner = load_aligner(args.model, args.dtype, args.device_map)
    except Exception as exc:  # pragma: no cover - runtime env specific
        raise RuntimeError(
            "无法加载 Qwen3-ForcedAligner。请确认已在当前 Python 环境安装 qwen-asr，"
            "并优先使用官方建议的 Python 3.12 环境。"
        ) from exc

    chunks = build_chunk_plans(
        words,
        total_duration=duration,
        max_chunk_seconds=args.max_chunk_seconds,
        min_chunk_seconds=args.min_chunk_seconds,
        gap_threshold_seconds=args.gap_threshold_seconds,
        padding_seconds=args.padding_seconds,
    )
    eprint(f"[force-align] source tokens={len(words)}, chunks={len(chunks)}")

    aligned_tokens, token_groups_by_word, chunk_debug = align_chunks(
        aligner=aligner,
        audio_path=audio_path,
        words=words,
        chunks=chunks,
        language=language,
        batch_size=max(1, int(args.batch_size)),
    )

    aligned_word_transcript, fallback_count = build_aligned_word_transcript(
        words,
        token_groups_by_word,
        duration,
    )
    aligned_token_transcript = build_aligned_token_transcript(aligned_tokens, duration)

    aligned_word_path = output_dir / "transcript_aligned_words.json"
    aligned_token_path = output_dir / "transcript_aligned_tokens.json"
    manifest_path = output_dir / "force_align_manifest.json"

    write_json(aligned_word_path, aligned_word_transcript)
    write_json(aligned_token_path, aligned_token_transcript)

    manifest = {
        "version": 1,
        "tool": "Qwen3-ForcedAligner",
        "model": args.model,
        "language": language,
        "deviceMap": args.device_map,
        "dtype": args.dtype,
        "audioPath": audio_path,
        "transcriptPath": str(transcript_path),
        "outputs": {
            "alignedWordTranscriptPath": str(aligned_word_path),
            "alignedTokenTranscriptPath": str(aligned_token_path),
            "manifestPath": str(manifest_path),
        },
        "summary": {
            "rawWordCount": len(words),
            "alignedWordCount": len(aligned_word_transcript["words"]),
            "alignedTokenCount": len(aligned_tokens),
            "fallbackWordCount": fallback_count,
            "chunkCount": len(chunks),
            "batchSize": max(1, int(args.batch_size)),
            "maxChunkSeconds": float(args.max_chunk_seconds),
            "minChunkSeconds": float(args.min_chunk_seconds),
            "gapThresholdSeconds": float(args.gap_threshold_seconds),
            "paddingSeconds": float(args.padding_seconds),
        },
        "chunks": chunk_debug,
    }
    write_json(manifest_path, manifest)

    print(
        json.dumps(
            {
                "manifestPath": str(manifest_path),
                "alignedWordTranscriptPath": str(aligned_word_path),
                "alignedTokenTranscriptPath": str(aligned_token_path),
                "summary": manifest["summary"],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        eprint(f"[force-align] error: {exc}")
        raise
