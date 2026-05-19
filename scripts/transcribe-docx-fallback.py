#!/usr/bin/env python
from __future__ import annotations

import argparse
import json
import re
import subprocess
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(
        description="Fallback transcript generator: use docx text and spread tokens across media duration."
    )
    ap.add_argument("--audio", required=True)
    ap.add_argument("--docx", required=True)
    ap.add_argument("--output-dir", required=True)
    return ap.parse_args()


def extract_docx_text(path: Path) -> str:
    with zipfile.ZipFile(path) as zf:
        xml_bytes = zf.read("word/document.xml")
    root = ET.fromstring(xml_bytes)
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    parts = [node.text for node in root.iter(f"{{{ns['w']}}}t") if node.text]
    return "\n".join(parts)


def media_duration(path: Path) -> float:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=nw=1:nk=1",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(result.stdout.strip())


def tokenize(text: str) -> list[str]:
    text = re.sub(r"\s+", "", text)
    # Chinese characters become individual timing units; contiguous ASCII/digits stay together.
    return re.findall(r"[\u4e00-\u9fff]|[A-Za-z0-9.%％+-]+|[^\s]", text)


def main() -> None:
    args = parse_args()
    audio = Path(args.audio).resolve()
    docx = Path(args.docx).resolve()
    out = Path(args.output_dir).resolve()
    out.mkdir(parents=True, exist_ok=True)

    text = extract_docx_text(docx)
    tokens = tokenize(text)
    duration = max(0.1, media_duration(audio))
    if not tokens:
        raise SystemExit(f"No text extracted from {docx}")

    step = duration / len(tokens)
    words = []
    for index, token in enumerate(tokens):
        start = round(index * step, 3)
        end = round(min(duration, (index + 1) * step), 3)
        words.append(
            {
                "text": token,
                "start": start,
                "end": max(start + 0.001, end),
                "source_word_indices": [index],
                "source_start": start,
                "source_end": max(start + 0.001, end),
                "synthetic": True,
            }
        )

    transcript = {"duration": round(duration, 3), "words": words}
    (out / "transcript_raw.json").write_text(
        json.dumps(transcript, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (out / "transcript_raw.txt").write_text(text, encoding="utf-8")
    (out / "transcribe_docx_fallback_manifest.json").write_text(
        json.dumps(
            {
                "tool": "transcribe-docx-fallback",
                "audio": str(audio),
                "docx": str(docx),
                "duration": round(duration, 3),
                "tokenCount": len(tokens),
                "warning": "Synthetic timing; use only when qwen_asr is unavailable.",
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"fallback transcript: {len(tokens)} tokens, duration={duration:.3f}s -> {out / 'transcript_raw.json'}")


if __name__ == "__main__":
    main()
