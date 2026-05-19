# -*- coding: utf-8 -*-
"""Step 1 (atoms version): Classify logic blocks using atoms original text.

Usage:
  python scripts/cluster-logic-blocks-atoms.py [--batch-size 40] [--max-batches 0] [--start-batch 0]
"""

import json
import subprocess
import sys
import time
from pathlib import Path

INPUT_PATH = Path("f:/AI total editing/editing V1/scripts/all_logic_blocks_atoms.json")
OUTPUT_DIR = Path("f:/AI total editing/editing V1/scripts/cluster_atoms/step1_batches")
MERGED_PATH = Path("f:/AI total editing/editing V1/scripts/cluster_atoms/step1_all_labels.json")

BATCH_SIZE = 40

SYSTEM_PROMPT = """你是医学科普视频制作专家。你的任务是判断每个 logic block 是否需要医学动画素材来可视化。

重要：请根据「医生原话」来判断，这是医生实际说的口播内容。

"需要医学动画"的标准——医生原话正在**讲解**以下内容：
1. 病理过程（斑块形成、血栓、缺血坏死、炎症反应…）
2. 生理机制（心脏泵血、血压调节、代谢通路、神经传导…）
3. 解剖结构（冠状动脉、心脏瓣膜、肾脏结构、血管壁…）
4. 手术/检查过程（支架植入、球囊扩张、冠脉造影、搭桥…）
5. 药物作用机制（他汀靶点、降压药机制、抗凝原理…）

不需要医学动画的：
- 观点、金句、情感号召
- 纯数字强调
- 生活方式建议列表
- 误区纠正的逻辑对比
- 症状主观描述（"胸口闷、紧"）
- 行动指南（"去医院挂什么科"）
- 比喻说理（"就像汽车发动机"）但如果比喻中穿插了具体机制讲解则算需要

对于需要医学动画的 block，给出一个语义标签，描述它需要展示的具体医学过程。
标签要基于医生原话的实际内容，而不是概括性的主题。
例如："纤维帽在情绪激动时破裂"而不是笼统的"斑块破裂"。"""

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
                    "index": {"type": "integer"},
                    "needs_animation": {"type": "boolean"},
                    "label": {"type": "string", "description": "语义标签，不需要动画时为空字符串"}
                },
                "required": ["index", "needs_animation", "label"]
            }
        }
    },
    "required": ["results"]
}


def format_block(i: int, block: dict) -> str:
    atoms = block["atoms_text"][:250] if block["atoms_text"] else "(无原文)"
    return f"[{i}] 蓝图《{block['bp_title']}》场景「{block['scene_title']}」\n    医生原话: {atoms}"


def call_claude_cli(prompt: str, system: str, schema: dict) -> dict:
    schema_str = json.dumps(schema, ensure_ascii=False)
    cmd = [
        "claude", "-p",
        "--model", "opus",
        "--output-format", "json",
        "--json-schema", schema_str,
        "--system-prompt", system,
        "--no-session-persistence",
        "-",
    ]
    result = subprocess.run(
        cmd, input=prompt,
        capture_output=True, text=True, encoding="utf-8", timeout=300,
    )
    if result.returncode != 0:
        raise RuntimeError(f"claude CLI failed (rc={result.returncode}): {result.stderr[:500]}")
    response = json.loads(result.stdout)
    if "structured_output" in response:
        return response["structured_output"]
    if "result" in response:
        inner = response["result"]
        if isinstance(inner, str):
            return json.loads(inner)
        return inner
    return response


def process_batch(batch_idx: int, blocks: list[dict], offset: int) -> list[dict]:
    blocks_text = "\n".join(format_block(i, b) for i, b in enumerate(blocks))
    prompt = USER_PROMPT_TEMPLATE.format(count=len(blocks), blocks_text=blocks_text)

    response = call_claude_cli(prompt, SYSTEM_PROMPT, JSON_SCHEMA)
    results = response.get("results", [])

    labeled = []
    for r in results:
        local_idx = r["index"]
        if local_idx < len(blocks):
            block = blocks[local_idx]
            labeled.append({
                "global_index": offset + local_idx,
                "seg_id": block["seg_id"],
                "bp_title": block["bp_title"],
                "scene_title": block["scene_title"],
                "template": block["template"],
                "items": block["items"],
                "atoms_text": block["atoms_text"],
                "needs_animation": r["needs_animation"],
                "label": r["label"],
            })
    return labeled


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    parser.add_argument("--max-batches", type=int, default=0)
    parser.add_argument("--start-batch", type=int, default=0)
    args = parser.parse_args()

    with open(INPUT_PATH, "r", encoding="utf-8") as f:
        all_blocks = json.load(f)

    print(f"Total blocks: {len(all_blocks)}")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    batches = []
    for i in range(0, len(all_blocks), args.batch_size):
        batches.append((i, all_blocks[i:i + args.batch_size]))

    total_batches = len(batches)
    if args.max_batches > 0:
        batch_range = batches[args.start_batch:args.start_batch + args.max_batches]
    else:
        batch_range = batches[args.start_batch:]

    print(f"Total batches: {total_batches}, processing: {len(batch_range)} (from {args.start_batch})")

    all_labeled = []
    for batch_num, (offset, batch_blocks) in enumerate(batch_range):
        actual_idx = args.start_batch + batch_num
        batch_file = OUTPUT_DIR / f"batch_{actual_idx:04d}.json"

        if batch_file.exists():
            print(f"[Batch {actual_idx}/{total_batches}] Already done, loading...")
            with open(batch_file, "r", encoding="utf-8") as f:
                labeled = json.load(f)
            all_labeled.extend(labeled)
            continue

        print(f"[Batch {actual_idx}/{total_batches}] Processing {len(batch_blocks)} blocks...")
        t0 = time.time()

        try:
            labeled = process_batch(actual_idx, batch_blocks, offset)
            with open(batch_file, "w", encoding="utf-8") as f:
                json.dump(labeled, f, ensure_ascii=False, indent=2)

            anim_count = sum(1 for r in labeled if r["needs_animation"])
            elapsed = time.time() - t0
            print(f"  Done in {elapsed:.1f}s — {anim_count}/{len(labeled)} need animation")
            all_labeled.extend(labeled)

        except Exception as e:
            print(f"  ERROR: {e}")
            print(f"  Resume with --start-batch {actual_idx}")
            break

    # Merge
    with open(MERGED_PATH, "w", encoding="utf-8") as f:
        json.dump(all_labeled, f, ensure_ascii=False, indent=2)

    anim_total = sum(1 for r in all_labeled if r["needs_animation"])
    labels = set(r["label"] for r in all_labeled if r["needs_animation"] and r["label"])
    print(f"\nTotal processed: {len(all_labeled)}")
    print(f"Need animation: {anim_total}")
    print(f"Unique labels: {len(labels)}")
    print(f"Output: {MERGED_PATH}")


if __name__ == "__main__":
    main()
