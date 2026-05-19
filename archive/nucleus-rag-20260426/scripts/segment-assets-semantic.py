# -*- coding: utf-8 -*-
"""Semantic segmentation of Nucleus assets.

For each video with narration, sends full narration to Claude to identify
semantic passages (continuous segments covering one medical process/concept).

Usage:
  python scripts/segment-assets-semantic.py [--max-assets 0] [--start 0]
"""

import json
import subprocess
import time
from pathlib import Path

ASSET_INDEX_PATH = Path("P:/团队空间/公司通用/AIkaifa/nucleus/cardiology/asset_index.json")
OUTPUT_DIR = Path("f:/AI total editing/editing V1/scripts/cluster_atoms/asset_passages")
MERGED_PATH = Path("f:/AI total editing/editing V1/scripts/cluster_atoms/asset_passages_all.json")

SYSTEM_PROMPT = """你是医学动画视频内容分析专家。你的任务是把一个医学教育视频的旁白按语义切成若干段落（passage）。

每个段落应该是一个完整的医学概念/过程/步骤，例如：
- "动脉粥样硬化的危险因素" 是一个段落
- "斑块形成过程" 是另一个段落
- "纤维帽破裂与血栓形成" 是另一个段落

切割原则：
1. 每个段落讲一个完整的医学主题，不要切太碎（3-5句话以上）
2. 也不要太粗（一个段落不要超过60秒）
3. 段落边界应在旁白的自然语义转折处
4. 对于非医学内容（如开场白"please watch this video"、结尾总结"talk to your doctor"），单独标记为非医学段落
5. 每个段落给出中文语义摘要，描述该段画面展示的医学内容"""


def build_narration_text(asset: dict) -> tuple[str, list]:
    """Build formatted narration with timestamps."""
    segs = asset.get("segments", [])
    good_segs = [s for s in segs if s.get("text_en", "") and s["text_en"] != "you" and len(s["text_en"]) > 10]
    lines = []
    for s in good_segs:
        lines.append(f'[{s["start"]:.1f}-{s["end"]:.1f}s] {s["text_en"]}')
    return "\n".join(lines), good_segs


def call_claude(prompt: str, system: str, schema: dict) -> dict:
    schema_str = json.dumps(schema, ensure_ascii=False)
    cmd = [
        "claude", "-p", "--model", "opus",
        "--output-format", "json",
        "--json-schema", schema_str,
        "--system-prompt", system,
        "--no-session-persistence", "-",
    ]
    result = subprocess.run(
        cmd, input=prompt,
        capture_output=True, text=True, encoding="utf-8", timeout=300,
    )
    if result.returncode != 0:
        raise RuntimeError(f"claude CLI failed: {result.stderr[:500]}")
    response = json.loads(result.stdout)
    if "structured_output" in response:
        return response["structured_output"]
    return response


JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "passages": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "start_sec": {"type": "number"},
                    "end_sec": {"type": "number"},
                    "summary_zh": {"type": "string", "description": "中文语义摘要，描述该段展示的医学内容"},
                    "is_medical": {"type": "boolean", "description": "是否为医学机制/过程内容（非开场白/结尾等）"},
                },
                "required": ["start_sec", "end_sec", "summary_zh", "is_medical"]
            }
        }
    },
    "required": ["passages"]
}


def process_asset(asset: dict, idx: int) -> list[dict]:
    narration_text, good_segs = build_narration_text(asset)
    if not narration_text:
        return []

    prompt = f"""视频标题: {asset['title']}
时长: {asset['duration']:.1f}s

完整旁白（带时间戳）:
{narration_text}

请按语义切割成段落。"""

    result = call_claude(prompt, SYSTEM_PROMPT, JSON_SCHEMA)
    passages = result.get("passages", [])

    # Enrich with asset info
    for p in passages:
        p["file"] = asset["file"]
        p["title"] = asset["title"]
        # Collect narration text within this passage
        p["text_en"] = " ".join(
            s["text_en"] for s in good_segs
            if s["start"] >= p["start_sec"] - 0.5 and s["end"] <= p["end_sec"] + 0.5
            and s.get("text_en", "") and s["text_en"] != "you"
        )

    return passages


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-assets", type=int, default=0)
    parser.add_argument("--start", type=int, default=0)
    args = parser.parse_args()

    with open(ASSET_INDEX_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Filter to assets with narration
    assets = []
    for a in data["assets"]:
        good = [s for s in a.get("segments", []) if s.get("text_en", "") and s["text_en"] != "you" and len(s["text_en"]) > 10]
        if good:
            assets.append(a)

    print(f"Assets with narration: {len(assets)}")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    if args.max_assets > 0:
        assets = assets[args.start:args.start + args.max_assets]
    else:
        assets = assets[args.start:]

    all_passages = []

    for i, asset in enumerate(assets):
        actual_idx = args.start + i
        cache_file = OUTPUT_DIR / f"asset_{actual_idx:04d}.json"

        if cache_file.exists():
            with open(cache_file, "r", encoding="utf-8") as f:
                passages = json.load(f)
            medical = sum(1 for p in passages if p.get("is_medical"))
            print(f"[{actual_idx}/{args.start + len(assets)}] {asset['title'][:40]:40s} — cached ({len(passages)} passages, {medical} medical)")
            all_passages.extend(passages)
            continue

        print(f"[{actual_idx}/{args.start + len(assets)}] {asset['title'][:40]:40s}...", end=" ", flush=True)
        t0 = time.time()

        try:
            passages = process_asset(asset, actual_idx)
            with open(cache_file, "w", encoding="utf-8") as f:
                json.dump(passages, f, ensure_ascii=False, indent=2)

            medical = sum(1 for p in passages if p.get("is_medical"))
            print(f"{time.time()-t0:.1f}s — {len(passages)} passages, {medical} medical")
            all_passages.extend(passages)

        except Exception as e:
            print(f"ERROR: {e}")
            print(f"Resume with --start {actual_idx}")
            break

    # Merge
    with open(MERGED_PATH, "w", encoding="utf-8") as f:
        json.dump(all_passages, f, ensure_ascii=False, indent=2)

    medical_total = sum(1 for p in all_passages if p.get("is_medical"))
    print(f"\nTotal passages: {len(all_passages)}")
    print(f"Medical passages: {medical_total}")
    print(f"Output: {MERGED_PATH}")


if __name__ == "__main__":
    main()
