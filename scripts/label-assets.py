# -*- coding: utf-8 -*-
"""Auto-label medical animation assets using multimodal LLM.

Extracts key frames from each video, sends them to a vision LLM,
and produces a structured asset index JSON.

Usage:
  python scripts/label-assets.py <asset_dir> [-o <output.json>] [--dry-run]
"""

import argparse
import base64
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

# ---------------------------------------------------------------------------
# Sub-scene taxonomy (from 文案场景语义素材清单.xlsx)
# ---------------------------------------------------------------------------
SUB_SCENES_TAXONOMY = """
## 可选的子场景列表（父场景 → 子场景）

血管内部机制讲解:
  - 支架植入过程
  - 血管逐渐狭窄
  - 动脉硬化过程
  - 血管完全堵塞
  - 斑块破裂→急性血栓
  - 血栓脱落→远端栓塞
  - 球囊扩张过程
  - 血管弹性对比

心脏工作机制:
  - 心肌缺血过程
  - 冠状动脉供血
  - 心脏电传导系统
  - 心脏收缩舒张周期
  - 心脏负担加重
  - 心脏瓣膜工作

药物作用机制:
  - 他汀降脂过程
  - 降压药扩血管
  - 阿司匹林抗血小板
  - 副作用/不良反应
  - 布洛芬止痛原理
  - 胰岛素降糖

免疫/感染机制:
  - 免疫系统总览
  - 免疫细胞吞噬病原体
  - 白细胞/淋巴细胞工作
  - 炎症反应过程
  - 抗体结合病原体
  - 病毒入侵细胞
  - 细菌/真菌感染过程

神经调控机制:
  - 交感神经兴奋
  - 植物神经紊乱
  - 脑血管示意
  - 迷走神经调节
  - 神经递质传递

血脂代谢机制:
  - LDL运输与沉积
  - HDL清除胆固醇
  - 肝脏合成与代谢
  - 血脂升高过程

血糖/胰岛素机制:
  - 胰岛素抵抗过程
  - 血糖调控循环
  - 葡萄糖进出细胞
  - 胰岛细胞分泌

血压调控机制:
  - 血压升高全过程
  - 交感神经→血管收缩
  - RAAS系统激活
  - 血压波动

器官/部位3D展示:
  - 甲状腺位置和结构
  - 颈动脉走行
  - 冠状动脉分布
  - 胰腺位置
  - 颈椎/腰椎结构
  - 膝关节结构
  - 前列腺位置
  - 心脏四腔结构
  - 主动脉走行

肿瘤/癌变机制:
  - 良恶性对比
  - 肺结节观察
  - 癌细胞增殖
  - 基因突变过程

检查报告/结果展示:
  - 心电图波形
  - CT/影像片子
  - 心脏造影画面

如果素材不属于以上任何子场景，可以自定义新的子场景名称，格式为"父场景/子场景"。
"""

SYSTEM_PROMPT = f"""你是一个医学动画素材标注专家。你需要根据视频关键帧来分析医学动画素材的内容，并输出结构化标签。

{SUB_SCENES_TAXONOMY}

注意事项：
1. 一个素材可以属于多个子场景
2. 如果素材较长且不同时间段展示不同内容，请拆分为多个 segments，标注每段的起止时间和内容
3. visual_desc 用一句话描述画面内容，帮助后续匹配
4. 只输出 JSON，不要输出其他内容"""

USER_PROMPT_TEMPLATE = """这是一个医学动画素材的关键帧截图，素材文件名为「{filename}」，所在文件夹为「{folder}」，总时长 {duration:.1f} 秒。

关键帧分别取自视频的 {frame_times} 位置。

请分析这些关键帧，输出以下 JSON 格式：

```json
{{
  "sub_scenes": ["子场景1", "子场景2"],
  "visual_desc": "一句话描述画面内容",
  "segments": [
    {{"start": 0, "end": 3.5, "desc": "这段展示的内容"}},
    {{"start": 3.5, "end": 8.2, "desc": "这段展示的内容"}}
  ]
}}
```

如果整个素材内容统一，segments 只需要一段即可。"""


def get_duration(video_path: str) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
         "-of", "csv=p=0", video_path],
        capture_output=True, text=True
    )
    return float(result.stdout.strip())


def extract_frames(video_path: str, num_frames: int = 5) -> list[tuple[str, float]]:
    """Extract evenly-spaced frames, return list of (jpg_path, timestamp_sec)."""
    duration = get_duration(video_path)
    if duration <= 0:
        return []

    # Pick evenly spaced timestamps (avoid very start/end)
    margin = min(0.5, duration * 0.05)
    timestamps = []
    if num_frames == 1:
        timestamps = [duration / 2]
    else:
        step = (duration - 2 * margin) / (num_frames - 1)
        for i in range(num_frames):
            timestamps.append(margin + i * step)

    tmpdir = tempfile.mkdtemp(prefix="asset_frames_")
    frames = []
    for i, ts in enumerate(timestamps):
        out_path = os.path.join(tmpdir, f"frame_{i:02d}.jpg")
        subprocess.run(
            ["ffmpeg", "-y", "-ss", str(ts), "-i", video_path,
             "-frames:v", "1", "-q:v", "3", out_path],
            capture_output=True
        )
        if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
            frames.append((out_path, ts))

    return frames


def encode_image(path: str) -> str:
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def call_vision_llm(frames: list[tuple[str, float]], filename: str,
                     folder: str, duration: float) -> dict:
    """Call Claude vision API with frames and get structured labels."""
    import anthropic

    client = anthropic.Anthropic(
        api_key=os.environ.get("ANTHROPIC_API_KEY"),
        base_url=os.environ.get("ANTHROPIC_BASE_URL"),
    )

    frame_times = ", ".join(f"{ts:.1f}s" for _, ts in frames)

    content = []
    for frame_path, _ in frames:
        b64 = encode_image(frame_path)
        content.append({
            "type": "image",
            "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}
        })

    content.append({
        "type": "text",
        "text": USER_PROMPT_TEMPLATE.format(
            filename=filename, folder=folder,
            duration=duration, frame_times=frame_times
        )
    })

    model = os.environ.get("LABEL_MODEL", "claude-sonnet-4-6")

    response = client.messages.create(
        model=model,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": content}],
        temperature=0.1,
        max_tokens=1024,
    )

    text = response.content[0].text.strip()

    # Extract JSON from markdown code block if present
    if "```json" in text:
        text = text.split("```json")[1].split("```")[0].strip()
    elif "```" in text:
        text = text.split("```")[1].split("```")[0].strip()

    return json.loads(text)


def process_directory(asset_dir: Path, output_path: Path, dry_run: bool = False):
    video_exts = {".mp4", ".mov", ".avi", ".mkv"}
    videos = sorted(
        f for f in asset_dir.rglob("*")
        if f.suffix.lower() in video_exts
    )

    print(f"Found {len(videos)} videos in {asset_dir}")

    # Load existing index if present (for incremental updates)
    existing = {}
    if output_path.exists():
        idx = json.loads(output_path.read_text(encoding="utf-8"))
        for a in idx.get("assets", []):
            existing[a["file"]] = a
        print(f"Loaded existing index with {len(existing)} entries")

    assets = []
    skipped = 0
    failed = 0

    for i, video in enumerate(videos):
        rel_path = str(video.relative_to(asset_dir)).replace("\\", "/")
        folder = str(video.parent.relative_to(asset_dir)).replace("\\", "/")
        filename = video.name

        # Skip if already indexed
        if rel_path in existing:
            assets.append(existing[rel_path])
            skipped += 1
            continue

        print(f"\n[{i+1}/{len(videos)}] {rel_path}")

        if dry_run:
            print("  (dry-run, skipping)")
            continue

        try:
            duration = get_duration(str(video))
            num_frames = 3 if duration < 10 else 5
            frames = extract_frames(str(video), num_frames)

            if not frames:
                print("  [SKIP] no frames extracted")
                failed += 1
                continue

            print(f"  duration={duration:.1f}s, frames={len(frames)}")

            labels = call_vision_llm(frames, filename, folder, duration)
            print(f"  sub_scenes: {labels.get('sub_scenes', [])}")
            print(f"  visual_desc: {labels.get('visual_desc', '')}")

            asset_entry = {
                "file": rel_path,
                "duration": round(duration, 1),
                "sub_scenes": labels.get("sub_scenes", []),
                "visual_desc": labels.get("visual_desc", ""),
                "segments": labels.get("segments", [
                    {"start": 0, "end": round(duration, 1), "desc": labels.get("visual_desc", "")}
                ]),
            }
            assets.append(asset_entry)

            # Clean up temp frames
            for frame_path, _ in frames:
                try:
                    os.remove(frame_path)
                    os.rmdir(os.path.dirname(frame_path))
                except OSError:
                    pass

        except Exception as e:
            print(f"  [ERROR] {e}")
            failed += 1
            continue

    if not dry_run:
        index = {"asset_root": str(asset_dir), "assets": assets}
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            json.dumps(index, ensure_ascii=False, indent=2),
            encoding="utf-8"
        )
        print(f"\nDone. total={len(videos)} indexed={len(assets)} skipped={skipped} failed={failed}")
        print(f"Output: {output_path}")
    else:
        print(f"\nDry run. {len(videos)} videos found, {skipped} already indexed")


def main():
    parser = argparse.ArgumentParser(description="Auto-label medical animation assets")
    parser.add_argument("asset_dir", help="Root directory of assets")
    parser.add_argument("-o", "--output", default=None,
                        help="Output JSON path (default: <asset_dir>/asset_index.json)")
    parser.add_argument("--dry-run", action="store_true",
                        help="List files without calling LLM")
    args = parser.parse_args()

    asset_dir = Path(args.asset_dir).resolve()
    output = Path(args.output) if args.output else asset_dir / "asset_index.json"

    if not asset_dir.is_dir():
        print(f"Error: {asset_dir} is not a directory")
        sys.exit(1)

    process_directory(asset_dir, output, args.dry_run)


if __name__ == "__main__":
    main()
