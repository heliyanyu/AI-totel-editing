#!/usr/bin/env python3
"""
转录服务 - Phase 1

MP4 视频 → 带字级时间戳的 JSON

用法:
    python src/transcribe/index.py input.mp4 -o transcript.json
    python src/transcribe/index.py input.mp4  # 默认输出到同目录下 transcript.json
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


def extract_audio(video_path: str, wav_path: str) -> None:
    """用 FFmpeg 从视频中提取 16kHz mono WAV 音频"""
    cmd = [
        "ffmpeg",
        "-i", video_path,
        "-vn",                   # 不要视频
        "-acodec", "pcm_s16le",  # 16-bit PCM
        "-ar", "16000",          # 16kHz
        "-ac", "1",              # mono
        "-y",                    # 覆盖
        wav_path,
    ]
    result = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if result.returncode != 0:
        print(f"FFmpeg 错误:\n{result.stderr}", file=sys.stderr)
        raise RuntimeError(f"FFmpeg 提取音频失败 (exit code {result.returncode})")


def transcribe_audio(wav_path: str, model_size: str = "large-v3") -> dict:
    """用 faster-whisper 转录音频，返回 word-level 时间戳 JSON"""
    import torch
    from faster_whisper import WhisperModel

    if torch.cuda.is_available():
        device = "cuda"
        compute_type = "float16"
    else:
        device = "cpu"
        compute_type = "int8"

    print(f"  加载模型: {model_size} ({device} {compute_type}) ...")
    model = WhisperModel(model_size, device=device, compute_type=compute_type)

    print("  开始转录 ...")
    segments, info = model.transcribe(
        wav_path,
        language="zh",
        word_timestamps=True,
        vad_filter=True,
        vad_parameters=dict(
            min_silence_duration_ms=300,
        ),
    )

    words = []
    for segment in segments:
        if segment.words:
            for word in segment.words:
                words.append({
                    "text": word.word.strip(),
                    "start": round(word.start, 3),
                    "end": round(word.end, 3),
                })

    return {
        "duration": round(info.duration, 3),
        "language": info.language,
        "language_probability": round(info.language_probability, 3),
        "words": words,
    }


def main():
    parser = argparse.ArgumentParser(
        description="MP4 视频转录为带字级时间戳的 JSON"
    )
    parser.add_argument(
        "input",
        help="输入 MP4 视频文件路径",
    )
    parser.add_argument(
        "-o", "--output",
        help="输出 JSON 文件路径 (默认: 同目录下 transcript.json)",
        default=None,
    )
    parser.add_argument(
        "--model",
        help="Whisper 模型大小 (默认: large-v3)",
        default="large-v3",
    )
    args = parser.parse_args()

    input_path = os.path.abspath(args.input)
    if not os.path.isfile(input_path):
        print(f"错误: 输入文件不存在: {input_path}", file=sys.stderr)
        sys.exit(1)

    # 确定输出路径
    if args.output:
        output_path = os.path.abspath(args.output)
    else:
        input_dir = os.path.dirname(input_path)
        output_path = os.path.join(input_dir, "transcript.json")

    # 确保输出目录存在
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    print(f"输入: {input_path}")
    print(f"输出: {output_path}")

    # Step 1: 提取音频到临时 WAV
    print("\nStep 1: 提取音频 ...")
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        wav_path = tmp.name

    try:
        extract_audio(input_path, wav_path)
        wav_size_mb = os.path.getsize(wav_path) / (1024 * 1024)
        print(f"  音频提取完成: {wav_size_mb:.1f} MB")

        # Step 2: 转录
        print("\nStep 2: 转录 ...")
        result = transcribe_audio(wav_path, model_size=args.model)
        print(f"  转录完成: {len(result['words'])} 个词, 时长 {result['duration']:.1f}s")

        # Step 3: 输出 JSON
        print("\nStep 3: 写入 JSON ...")
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print(f"  已保存: {output_path}")

    finally:
        # 清理临时 WAV
        if os.path.exists(wav_path):
            os.unlink(wav_path)
            print(f"\n  临时文件已清理")

    print(f"\n完成!")
    print(f"  词数: {len(result['words'])}")
    print(f"  时长: {result['duration']:.1f}s")


if __name__ == "__main__":
    main()
