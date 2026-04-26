#!/usr/bin/env python
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List


def eprint(message: str) -> None:
    print(message, file=sys.stderr)


def round3(value: float) -> float:
    return round(float(value), 3)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Run Qwen3-ASR-1.7B transcription and emit the project's raw transcript schema."
        )
    )
    parser.add_argument("--audio", required=True, help="Path to the source audio/video file.")
    parser.add_argument("--output-dir", required=True, help="Directory to write transcript outputs.")
    parser.add_argument(
        "--model",
        default="Qwen/Qwen3-ASR-1.7B",
        help="Qwen3-ASR checkpoint repo id or local directory.",
    )
    parser.add_argument(
        "--aligner-model",
        default="Qwen/Qwen3-ForcedAligner-0.6B",
        help="Qwen3-ForcedAligner checkpoint repo id or local directory used for timestamp generation.",
    )
    parser.add_argument(
        "--language",
        default="Chinese",
        help='Transcription language name understood by qwen-asr. Use "auto" for auto-detection.',
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
        help="Torch dtype used when loading the ASR and aligner models.",
    )
    parser.add_argument(
        "--max-inference-batch-size",
        type=int,
        default=8,
        help="Batch size limit for inference. Smaller values can help avoid OOM.",
    )
    parser.add_argument(
        "--max-new-tokens",
        type=int,
        default=1024,
        help="Maximum number of new tokens generated for each chunk.",
    )
    parser.add_argument(
        "--context",
        default="",
        help="Optional Qwen ASR context string.",
    )
    parser.add_argument(
        "--docx",
        default="",
        help="Path to a .docx script file. Its text is used as ASR context (hotwords).",
    )
    return parser.parse_args()


def extract_docx_text(docx_path: str) -> str:
    """Extract plain text from a .docx file (zip of XML)."""
    import zipfile
    import xml.etree.ElementTree as ET

    with zipfile.ZipFile(docx_path) as zf:
        xml_bytes = zf.read("word/document.xml")
    root = ET.fromstring(xml_bytes)
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    return "".join(node.text for node in root.iter(f"{{{ns['w']}}}t") if node.text)


def write_json(path: Path, data: Any) -> None:
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def resolve_torch_dtype(dtype_name: str) -> Any:
    import torch

    mapping = {
        "bfloat16": torch.bfloat16,
        "float16": torch.float16,
        "float32": torch.float32,
    }
    return mapping[dtype_name]


def normalize_language_value(language: str) -> str | None:
    normalized = str(language).strip()
    if not normalized or normalized.lower() == "auto":
        return None
    return normalized


def load_model(
    *,
    model_name: str,
    aligner_model: str,
    dtype_name: str,
    device_map: str,
    max_inference_batch_size: int,
    max_new_tokens: int,
) -> Any:
    from qwen_asr import Qwen3ASRModel

    dtype = resolve_torch_dtype(dtype_name)
    kwargs = {
        "dtype": dtype,
        "device_map": device_map,
        "max_inference_batch_size": max_inference_batch_size,
        "max_new_tokens": max_new_tokens,
    }
    if aligner_model:
        kwargs["forced_aligner"] = aligner_model
        kwargs["forced_aligner_kwargs"] = {
            "dtype": dtype,
            "device_map": device_map,
        }

    return Qwen3ASRModel.from_pretrained(
        model_name,
        **kwargs,
    )


def load_audio(audio_path: str) -> tuple[Any, int, float]:
    from qwen_asr.inference.utils import SAMPLE_RATE, normalize_audio_input

    wav = normalize_audio_input(audio_path)
    duration = len(wav) / float(SAMPLE_RATE)
    return wav, SAMPLE_RATE, duration


def build_word_entry(index: int, item: Any) -> Dict[str, Any]:
    start = round3(float(item.start_time))
    end = round3(float(item.end_time))
    if end < start:
        start, end = end, start
    return {
        "text": str(item.text),
        "start": start,
        "end": end,
        "source_word_indices": [index],
        "source_start": start,
        "source_end": end,
    }


def build_transcript(result: Any, duration: float) -> Dict[str, Any]:
    items = list(getattr(result.time_stamps, "items", []) or [])
    words = [build_word_entry(index, item) for index, item in enumerate(items)]
    return {
        "duration": round3(duration),
        "words": words,
    }


def main() -> None:
    args = parse_args()

    audio_path = str(Path(args.audio).resolve())
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    if args.device_map.startswith("cpu") and args.dtype != "float32":
        eprint("[transcribe] cpu device_map detected, forcing dtype=float32")
        args.dtype = "float32"

    # Build context: explicit --context takes priority, else extract from --docx
    context = args.context
    if not context and args.docx:
        docx_path = Path(args.docx).resolve()
        if docx_path.exists():
            context = extract_docx_text(str(docx_path))
            eprint(f"[transcribe] hotword context from docx: {len(context)} chars")
        else:
            eprint(f"[transcribe] warning: docx not found: {docx_path}")

    language = normalize_language_value(args.language)

    eprint(
        f"[transcribe] loading asr={args.model} aligner={args.aligner_model or 'disabled'} "
        f"device_map={args.device_map} dtype={args.dtype}"
    )
    try:
        model = load_model(
            model_name=args.model,
            aligner_model=args.aligner_model,
            dtype_name=args.dtype,
            device_map=args.device_map,
            max_inference_batch_size=max(1, int(args.max_inference_batch_size)),
            max_new_tokens=max(1, int(args.max_new_tokens)),
        )
    except Exception as exc:  # pragma: no cover - runtime env specific
        raise RuntimeError(
            "Failed to load Qwen3-ASR/Qwen3-ForcedAligner. "
            "Please verify qwen-asr is installed in the target Python environment."
        ) from exc

    wav, sample_rate, duration = load_audio(audio_path)

    eprint(
        f"[transcribe] running transcription duration={round3(duration)}s "
        f"language={language or 'auto'}"
    )
    results = model.transcribe(
        audio=(wav, sample_rate),
        context=context,
        language=language,
        return_time_stamps=True,
    )

    if not results:
        raise RuntimeError("Qwen3-ASR returned no transcription results.")

    result = results[0]
    if result.time_stamps is None:
        raise RuntimeError(
            "Qwen3-ASR returned no timestamps. Raw transcription still requires approximate timestamps."
        )

    transcript = build_transcript(result, duration)

    transcript_path = output_dir / "transcript_raw.json"
    transcript_text_path = output_dir / "transcript_raw.txt"
    manifest_path = output_dir / "transcribe_qwen_manifest.json"

    write_json(transcript_path, transcript)
    transcript_text_path.write_text(result.text, encoding="utf-8")

    manifest = {
        "version": 1,
        "tool": "Qwen3-ASR",
        "model": args.model,
        "alignerModel": args.aligner_model or None,
        "audioPath": audio_path,
        "outputTranscriptPath": str(transcript_path),
        "outputTextPath": str(transcript_text_path),
        "languageRequested": language or "auto",
        "languageDetected": result.language,
        "context": context,
        "deviceMap": args.device_map,
        "dtype": args.dtype,
        "summary": {
            "duration": round3(duration),
            "wordCount": len(transcript["words"]),
            "textLength": len(result.text),
            "maxInferenceBatchSize": max(1, int(args.max_inference_batch_size)),
            "maxNewTokens": max(1, int(args.max_new_tokens)),
        },
    }
    write_json(manifest_path, manifest)

    print(
        json.dumps(
            {
                "transcriptPath": str(transcript_path),
                "transcriptTextPath": str(transcript_text_path),
                "manifestPath": str(manifest_path),
                "summary": manifest["summary"],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        eprint(f"[transcribe] error: {exc}")
        raise
