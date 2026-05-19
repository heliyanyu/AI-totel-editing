# -*- coding: utf-8 -*-
"""Label Nucleus medical animation assets using ASR transcription.

Transcribes English narration with Whisper, then uses the transcript
as precise time-stamped labels for each asset.

Usage:
  python scripts/label-nucleus-assets.py <asset_dir> [-o <output.json>] [--model <whisper_model>]
"""

import argparse
import json
import os
import sys
from pathlib import Path

import whisper


def transcribe_audio(audio_path: str, model) -> list[dict]:
    """Transcribe audio file, return list of segments with timestamps."""
    result = model.transcribe(str(audio_path), language="en", verbose=False)
    segments = []
    for seg in result.get("segments", []):
        segments.append({
            "start": round(seg["start"], 2),
            "end": round(seg["end"], 2),
            "text": seg["text"].strip(),
        })
    return segments


def get_duration(video_path: str) -> float:
    import subprocess
    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
         "-of", "csv=p=0", video_path],
        capture_output=True, text=True
    )
    try:
        return float(result.stdout.strip())
    except ValueError:
        return 0


def derive_sub_scenes_from_title(title: str) -> list[str]:
    """Extract sub_scene hints from the video filename/title."""
    title_lower = title.lower()

    mappings = {
        "angioplasty": "球囊扩张过程",
        "stent": "支架植入过程",
        "bypass": "冠状动脉搭桥",
        "cabg": "冠状动脉搭桥",
        "angiogram": "心脏造影画面",
        "angiography": "心脏造影画面",
        "catheterization": "心脏造影画面",
        "blood clot": "斑块破裂→急性血栓",
        "thrombus": "斑块破裂→急性血栓",
        "plaque": "动脉硬化过程",
        "atherosclerosis": "动脉硬化过程",
        "blockage": "血管逐渐狭窄",
        "blocked": "血管完全堵塞",
        "heart attack": "心肌缺血过程",
        "myocardial infarction": "心肌缺血过程",
        "heart failure": "心脏负担加重",
        "cardiac arrest": "心脏骤停急救",
        "arrhythmia": "心脏电传导系统",
        "fibrillation": "心脏电传导系统",
        "pacemaker": "心脏电传导系统",
        "valve": "心脏瓣膜工作",
        "aorta": "主动脉走行",
        "coronary": "冠状动脉供血",
        "blood pressure": "血压升高全过程",
        "hypertension": "血压升高全过程",
        "cholesterol": "LDL运输与沉积",
        "ecg": "心电图波形",
        "ekg": "心电图波形",
    }

    sub_scenes = []
    for keyword, scene in mappings.items():
        if keyword in title_lower and scene not in sub_scenes:
            sub_scenes.append(scene)

    return sub_scenes if sub_scenes else ["心脏工作机制"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("asset_dir", help="Directory with .mp4 and _audio.m4a files")
    parser.add_argument("-o", "--output", default=None)
    parser.add_argument("--model", default="base", help="Whisper model size (tiny/base/small/medium/large)")
    args = parser.parse_args()

    asset_dir = Path(args.asset_dir).resolve()
    output_path = Path(args.output) if args.output else asset_dir / "asset_index.json"

    # Find all mp4 files
    videos = sorted(asset_dir.glob("*.mp4"))
    print(f"Found {len(videos)} videos in {asset_dir}")

    # Load existing index for incremental updates
    existing = {}
    if output_path.exists():
        idx = json.loads(output_path.read_text(encoding="utf-8"))
        for a in idx.get("assets", []):
            existing[a["file"]] = a
        print(f"Loaded existing index with {len(existing)} entries")

    # Load whisper model
    print(f"Loading Whisper model '{args.model}'...")
    model = whisper.load_model(args.model)
    print("Model loaded.")

    assets = []
    for i, video in enumerate(videos):
        rel_path = video.name
        title = video.stem

        # Skip if already indexed
        if rel_path in existing:
            assets.append(existing[rel_path])
            continue

        # Find matching audio file
        audio_file = asset_dir / f"{title}_audio.m4a"
        if not audio_file.exists():
            # Try video file directly for audio
            audio_file = video

        duration = get_duration(str(video))
        print(f"\n[{i+1}/{len(videos)}] {title} ({duration:.1f}s)")

        # Transcribe
        has_narration = (asset_dir / f"{title}_audio.m4a").exists()
        if has_narration:
            print(f"  Transcribing audio...")
            segments = transcribe_audio(str(asset_dir / f"{title}_audio.m4a"), model)
            print(f"  {len(segments)} segments transcribed")

            # Build labeled segments from transcript
            labeled_segments = []
            for seg in segments:
                labeled_segments.append({
                    "start": seg["start"],
                    "end": seg["end"],
                    "text_en": seg["text"],
                    "desc": seg["text"],  # Will be translated later
                })
        else:
            print(f"  No audio file, using title only")
            labeled_segments = [{
                "start": 0,
                "end": round(duration, 1),
                "text_en": title.replace("_", " "),
                "desc": title.replace("_", " "),
            }]

        # Derive sub_scenes from title
        sub_scenes = derive_sub_scenes_from_title(title)

        asset_entry = {
            "file": rel_path,
            "title": title.replace("_", " "),
            "duration": round(duration, 1),
            "sub_scenes": sub_scenes,
            "visual_desc": title.replace("_", " "),
            "has_narration": has_narration,
            "segments": labeled_segments,
        }
        assets.append(asset_entry)

    # Write output
    index = {
        "asset_root": str(asset_dir),
        "assets": assets,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(index, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\nDone. {len(assets)} assets indexed.")
    print(f"Output: {output_path}")


if __name__ == "__main__":
    main()
