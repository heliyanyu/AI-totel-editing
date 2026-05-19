# -*- coding: utf-8 -*-
"""Step 3: Assign Nucleus segments to taxonomy categories via Claude CLI.

Reads asset_index.json + category_taxonomy.json, asks Claude to classify
each segment into categories. Outputs segment_categories.json.
"""

import json
import subprocess
import time
from pathlib import Path

ASSET_INDEX_PATH = Path("P:/团队空间/公司通用/AIkaifa/nucleus/cardiology/asset_index.json")
TAXONOMY_PATH = Path("f:/AI total editing/editing V1/scripts/cluster_results/category_taxonomy.json")
OUTPUT_DIR = Path("f:/AI total editing/editing V1/scripts/cluster_results/step3_batches")
MERGED_PATH = Path("f:/AI total editing/editing V1/scripts/cluster_results/segment_categories.json")

# Target ~40-50 segments per batch
MAX_SEGS_PER_BATCH = 50


def build_taxonomy_text(taxonomy: dict) -> str:
    """Build compact taxonomy reference for prompt."""
    lines = []
    for c in taxonomy["categories"]:
        lines.append(f'{c["id"]:3d}. {c["name"]} — {c["description"]}')
    return "\n".join(lines)


def build_batches(assets: list) -> list:
    """Group assets into batches with ~MAX_SEGS_PER_BATCH segments each."""
    batches = []
    current_batch = []
    current_seg_count = 0

    for asset in assets:
        segs = asset.get("segments", [])
        if not segs:
            # Still include for classification by title/sub_scenes
            segs = [{"start": 0, "end": asset.get("duration", 0), "text_en": "", "desc": ""}]

        seg_count = len(segs)

        # If single asset exceeds limit, it gets its own batch
        if seg_count > MAX_SEGS_PER_BATCH:
            if current_batch:
                batches.append(current_batch)
                current_batch = []
                current_seg_count = 0
            batches.append([asset])
            continue

        if current_seg_count + seg_count > MAX_SEGS_PER_BATCH and current_batch:
            batches.append(current_batch)
            current_batch = []
            current_seg_count = 0

        current_batch.append(asset)
        current_seg_count += seg_count

    if current_batch:
        batches.append(current_batch)

    return batches


def format_batch_assets(assets: list) -> str:
    """Format assets and their segments for the prompt."""
    lines = []
    global_seg_idx = 0
    for asset in assets:
        lines.append(f"\n### {asset['title']}")
        lines.append(f"sub_scenes: {', '.join(asset.get('sub_scenes', []))}")
        lines.append(f"duration: {asset.get('duration', 0):.1f}s")

        segs = asset.get("segments", [])
        if not segs:
            lines.append(f"  [{global_seg_idx}] 0.0-{asset.get('duration', 0):.1f}s | (无旁白，仅凭标题和sub_scenes分类)")
            global_seg_idx += 1
        else:
            for seg in segs:
                text = seg.get("text_en", "") or seg.get("desc", "")
                if not text or text == "you":
                    text = "(无旁白)"
                lines.append(f"  [{global_seg_idx}] {seg['start']:.1f}-{seg['end']:.1f}s | {text[:150]}")
                global_seg_idx += 1

    return "\n".join(lines)


def count_segments_in_batch(assets: list) -> int:
    total = 0
    for a in assets:
        segs = a.get("segments", [])
        total += max(len(segs), 1)
    return total


SYSTEM_PROMPT_TEMPLATE = """你是医学动画素材分类专家。你的任务是把视频片段归入已有的分类体系中。

分类目录（共{cat_count}个类别）：
{taxonomy_text}

规则：
1. 每个片段可以归入1-3个类别（取最相关的）
2. 根据片段的英文旁白内容 + 所属视频标题 + sub_scenes 综合判断
3. 对于没有旁白的片段，根据视频标题和sub_scenes推断内容
4. 如果片段内容确实不属于任何类别，category_ids 填空数组
5. 只填类别编号（id），不要填名称"""


def call_claude_cli(prompt: str, system: str, schema: dict) -> dict:
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
    if "structured_output" in response:
        return response["structured_output"]
    if "result" in response:
        inner = response["result"]
        if isinstance(inner, str):
            return json.loads(inner)
        return inner
    return response


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-batches", type=int, default=0)
    parser.add_argument("--start-batch", type=int, default=0)
    args = parser.parse_args()

    # Load data
    with open(ASSET_INDEX_PATH, "r", encoding="utf-8") as f:
        asset_data = json.load(f)
    assets = asset_data["assets"]

    with open(TAXONOMY_PATH, "r", encoding="utf-8") as f:
        taxonomy = json.load(f)

    taxonomy_text = build_taxonomy_text(taxonomy)
    cat_count = len(taxonomy["categories"])

    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        cat_count=cat_count, taxonomy_text=taxonomy_text
    )

    # Build batches
    batches = build_batches(assets)
    total_batches = len(batches)

    print(f"Assets: {len(assets)}, Segments: {sum(len(a.get('segments', [])) for a in assets)}")
    print(f"Batches: {total_batches}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    if args.max_batches > 0:
        batch_range = batches[args.start_batch:args.start_batch + args.max_batches]
    else:
        batch_range = batches[args.start_batch:]

    json_schema = {
        "type": "object",
        "properties": {
            "assignments": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "index": {"type": "integer", "description": "片段序号"},
                        "category_ids": {
                            "type": "array",
                            "items": {"type": "integer"},
                            "description": "归入的类别编号列表(1-3个)"
                        }
                    },
                    "required": ["index", "category_ids"]
                }
            }
        },
        "required": ["assignments"]
    }

    all_assignments = []

    for batch_num, batch_assets in enumerate(batch_range):
        actual_idx = args.start_batch + batch_num
        batch_file = OUTPUT_DIR / f"batch_{actual_idx:04d}.json"

        if batch_file.exists():
            print(f"[Batch {actual_idx}/{total_batches}] Already done, loading...")
            with open(batch_file, "r", encoding="utf-8") as f:
                batch_result = json.load(f)
            all_assignments.extend(batch_result)
            continue

        seg_count = count_segments_in_batch(batch_assets)
        print(f"[Batch {actual_idx}/{total_batches}] {len(batch_assets)} assets, {seg_count} segments...")

        assets_text = format_batch_assets(batch_assets)
        prompt = f"请将以下视频片段归入分类目录中的类别。\n{assets_text}"

        t0 = time.time()
        try:
            response = call_claude_cli(prompt, system_prompt, json_schema)
            assignments = response.get("assignments", [])

            # Enrich with asset/segment info
            enriched = []
            seg_flat = []
            for asset in batch_assets:
                segs = asset.get("segments", [])
                if not segs:
                    seg_flat.append({
                        "file": asset["file"],
                        "title": asset["title"],
                        "start": 0,
                        "end": asset.get("duration", 0),
                        "text_en": "",
                    })
                else:
                    for seg in segs:
                        seg_flat.append({
                            "file": asset["file"],
                            "title": asset["title"],
                            "start": seg["start"],
                            "end": seg["end"],
                            "text_en": seg.get("text_en", ""),
                        })

            for a in assignments:
                idx = a["index"]
                if idx < len(seg_flat):
                    seg_info = seg_flat[idx]
                    enriched.append({
                        **seg_info,
                        "category_ids": a["category_ids"],
                    })

            with open(batch_file, "w", encoding="utf-8") as f:
                json.dump(enriched, f, ensure_ascii=False, indent=2)

            elapsed = time.time() - t0
            assigned = sum(1 for e in enriched if e["category_ids"])
            print(f"  Done in {elapsed:.1f}s — {assigned}/{len(enriched)} assigned")

            all_assignments.extend(enriched)

        except Exception as e:
            print(f"  ERROR: {e}")
            print(f"  Resume with --start-batch {actual_idx}")
            break

    # Merge all
    with open(MERGED_PATH, "w", encoding="utf-8") as f:
        json.dump(all_assignments, f, ensure_ascii=False, indent=2)

    assigned_total = sum(1 for a in all_assignments if a["category_ids"])
    print(f"\nTotal segments processed: {len(all_assignments)}")
    print(f"Assigned to categories: {assigned_total}")
    print(f"Output: {MERGED_PATH}")


if __name__ == "__main__":
    main()
