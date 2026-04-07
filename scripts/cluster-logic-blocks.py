# -*- coding: utf-8 -*-
"""Step 1: Classify logic blocks via Claude CLI (Opus 4.6).

For each batch of logic blocks, ask Claude:
  - Does this block need medical animation? (yes/no)
  - If yes, assign a semantic label (free text, Chinese)

Usage:
  python scripts/cluster-logic-blocks.py [--batch-size 40] [--max-batches 0]
"""

import json
import os
import subprocess
import sys
import time
from pathlib import Path

INPUT_PATH = Path("f:/AI total editing/editing V1/scripts/all_logic_blocks.json")
OUTPUT_DIR = Path("f:/AI total editing/editing V1/scripts/cluster_results")
MERGED_PATH = OUTPUT_DIR / "step1_all_labels.json"

BATCH_SIZE = 40  # blocks per batch

SYSTEM_PROMPT = """你是医学科普视频制作专家。你的任务是判断每个 logic block 是否需要医学动画素材来可视化。

"需要医学动画"的标准——内容涉及以下五类之一：
1. 病理过程（斑块形成、血栓、缺血坏死、炎症反应…）
2. 生理机制（心脏泵血、血压调节、代谢通路、神经传导…）
3. 解剖结构（冠状动脉、心脏瓣膜、肾脏结构、血管壁…）
4. 手术/检查过程（支架植入、球囊扩���、冠脉造影、搭桥…）
5. 药物作用机制（他汀靶点、降压药机制、抗凝原理…）

不需要医学动画的：
- 观点、金句、情感号召（"听懂这期帮家人避开脑梗陷阱"）
- 纯数字强调（"1/2"、"54万"）
- 生活方式建议列表（"戒烟、限酒、不熬夜"）
- 误区纠正的逻辑对比（"以为是A → 其实是B"）
- 症状主观描述（"胸口闷、紧"）
- 行动指南（"去医院挂什么科"）

对于需要���学动画的 block，给出一个语义标签，描述它需要展示的医学过程/机制/结构。
标签要具体到单一过程，例如"冠状动脉斑块形成过程"而不是笼统的"心血管疾病"。
相似内容应该用相同或接近的标签措辞，方便后续聚类。"""

USER_PROMPT_TEMPLATE = """请分析以下 {count} 个 logic block，判断每个是否需要医学动画素材。

{blocks_text}

请对每个 block 输出判断结果。"""

JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "results": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {
                        "type": "integer",
                        "description": "block 在本批次中的序号，从 0 开始"
                    },
                    "needs_animation": {
                        "type": "boolean",
                        "description": "是否需要医学动画素材"
                    },
                    "label": {
                        "type": "string",
                        "description": "语义标签，仅当 needs_animation=true 时填写，否则为空字���串"
                    }
                },
                "required": ["index", "needs_animation", "label"]
            }
        }
    },
    "required": ["results"]
}


def format_block(i: int, block: dict) -> str:
    items_str = " | ".join(block["items"])
    return f"[{i}] 蓝图《{block['bp_title']}》场景「{block['scene_title']}」\n    模板: {block['template']} | 内容: {items_str}"


def call_claude_cli(prompt: str, system: str, schema: dict) -> dict:
    """Call claude CLI in print mode with JSON schema output."""
    schema_str = json.dumps(schema, ensure_ascii=False)

    cmd = [
        "claude", "-p",
        "--model", "opus",
        "--output-format", "json",
        "--json-schema", schema_str,
        "--system-prompt", system,
        "--no-session-persistence",
        prompt
    ]

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=300,
    )

    if result.returncode != 0:
        raise RuntimeError(f"claude CLI failed (rc={result.returncode}): {result.stderr[:500]}")

    response = json.loads(result.stdout)
    # --output-format json returns {"type":"result","structured_output":{...},...}
    if "structured_output" in response:
        return response["structured_output"]
    if "result" in response:
        inner = response["result"]
        if isinstance(inner, str):
            return json.loads(inner)
        return inner
    return response


def process_batch(batch_idx: int, blocks: list[dict], all_blocks_offset: int) -> list[dict]:
    """Process a single batch, return labeled results with global indices."""
    blocks_text = "\n".join(format_block(i, b) for i, b in enumerate(blocks))
    prompt = USER_PROMPT_TEMPLATE.format(count=len(blocks), blocks_text=blocks_text)

    response = call_claude_cli(prompt, SYSTEM_PROMPT, JSON_SCHEMA)
    results = response.get("results", [])

    # Attach global index and original block info
    labeled = []
    for r in results:
        local_idx = r["index"]
        if local_idx < len(blocks):
            block = blocks[local_idx]
            labeled.append({
                "global_index": all_blocks_offset + local_idx,
                "seg_id": block["seg_id"],
                "bp_title": block["bp_title"],
                "scene_title": block["scene_title"],
                "template": block["template"],
                "items": block["items"],
                "needs_animation": r["needs_animation"],
                "label": r["label"],
            })

    return labeled


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    parser.add_argument("--max-batches", type=int, default=0, help="0 = all")
    parser.add_argument("--start-batch", type=int, default=0, help="Resume from batch N")
    args = parser.parse_args()

    with open(INPUT_PATH, "r", encoding="utf-8") as f:
        all_blocks = json.load(f)

    print(f"Total blocks: {len(all_blocks)}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Split into batches
    batches = []
    for i in range(0, len(all_blocks), args.batch_size):
        batches.append((i, all_blocks[i:i + args.batch_size]))

    total_batches = len(batches)
    if args.max_batches > 0:
        batches = batches[args.start_batch:args.start_batch + args.max_batches]
    else:
        batches = batches[args.start_batch:]

    print(f"Total batches: {total_batches}, processing: {len(batches)} (from batch {args.start_batch})")

    all_labeled = []

    for batch_num, (offset, batch_blocks) in enumerate(batches):
        actual_batch_idx = args.start_batch + batch_num
        batch_file = OUTPUT_DIR / f"batch_{actual_batch_idx:04d}.json"

        # Skip if already processed
        if batch_file.exists():
            print(f"[Batch {actual_batch_idx}/{total_batches}] Already done, loading...")
            with open(batch_file, "r", encoding="utf-8") as f:
                labeled = json.load(f)
            all_labeled.extend(labeled)
            continue

        print(f"[Batch {actual_batch_idx}/{total_batches}] Processing {len(batch_blocks)} blocks (offset {offset})...")
        t0 = time.time()

        try:
            labeled = process_batch(actual_batch_idx, batch_blocks, offset)

            # Save batch result
            with open(batch_file, "w", encoding="utf-8") as f:
                json.dump(labeled, f, ensure_ascii=False, indent=2)

            anim_count = sum(1 for r in labeled if r["needs_animation"])
            elapsed = time.time() - t0
            print(f"  Done in {elapsed:.1f}s — {anim_count}/{len(labeled)} need animation")

            all_labeled.extend(labeled)

        except Exception as e:
            print(f"  ERROR: {e}")
            print(f"  Stopping. Resume with --start-batch {actual_batch_idx}")
            break

    # Merge all results
    with open(MERGED_PATH, "w", encoding="utf-8") as f:
        json.dump(all_labeled, f, ensure_ascii=False, indent=2)

    anim_total = sum(1 for r in all_labeled if r["needs_animation"])
    labels = set(r["label"] for r in all_labeled if r["needs_animation"] and r["label"])
    print(f"\nTotal processed: {len(all_labeled)}")
    print(f"Need animation: {anim_total}")
    print(f"Unique labels: {len(labels)}")
    print(f"Merged output: {MERGED_PATH}")


if __name__ == "__main__":
    main()
