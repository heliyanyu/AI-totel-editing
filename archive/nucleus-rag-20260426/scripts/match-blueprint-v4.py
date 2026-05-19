# -*- coding: utf-8 -*-
"""Match blueprint v4: merge consecutive ANIM blocks into groups, match as unit.

Usage:
  python scripts/match-blueprint-v4.py <blueprint.json>
"""

import json
import subprocess
import sys
import time
from pathlib import Path
from collections import defaultdict

TAXONOMY_PATH = Path("f:/AI total editing/editing V1/scripts/cluster_atoms/category_taxonomy_deduped.json")
PASSAGES_PATH = Path("f:/AI total editing/editing V1/scripts/cluster_atoms/passage_categories.json")
ASSET_INDEX_PATH = Path("P:/团队空间/公司通用/AIkaifa/nucleus/cardiology/asset_index.json")


def load_data():
    with open(TAXONOMY_PATH, "r", encoding="utf-8") as f:
        taxonomy = json.load(f)
    cat_map = {c["id"]: c for c in taxonomy["categories"]}

    with open(PASSAGES_PATH, "r", encoding="utf-8") as f:
        passages = json.load(f)
    cat_passages = defaultdict(list)
    for p in passages:
        for cid in p.get("category_ids", []):
            cat_passages[cid].append(p)

    with open(ASSET_INDEX_PATH, "r", encoding="utf-8") as f:
        asset_idx = json.load(f)
    asset_map = {a["file"]: a for a in asset_idx["assets"]}

    return cat_map, cat_passages, asset_map


def extract_blocks(bp):
    blocks = []
    for scene in bp["scenes"]:
        for seg in scene.get("logic_segments", []):
            items = [item["text"] for item in seg.get("items", [])]
            keep_atoms = [a for a in seg.get("atoms", []) if a.get("status") == "keep"]
            atoms_text = " ".join(a["text"] for a in keep_atoms)
            blocks.append({
                "seg_id": seg["id"],
                "scene_title": scene["title"],
                "items": items,
                "atoms_text": atoms_text,
            })
    return blocks


def build_category_summary(cat_map, cat_passages):
    lines = []
    for cid in sorted(cat_map.keys()):
        c = cat_map[cid]
        n = len(cat_passages.get(cid, []))
        if n > 0:
            lines.append(f'{cid:3d}. {c["name"]} ({n}个段落)')
    return "\n".join(lines)


def call_claude(prompt, system, schema):
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
        capture_output=True, text=True, encoding="utf-8", timeout=600,
    )
    if result.returncode != 0:
        raise RuntimeError(f"claude CLI failed: {result.stderr[:500]}")
    response = json.loads(result.stdout)
    if "structured_output" in response:
        return response["structured_output"]
    return response


def step1_classify(blocks, bp_title, cat_summary):
    blocks_text = "\n".join(
        f'[{i}] 场景「{b["scene_title"]}」\n    医生原话: {b["atoms_text"][:200]}'
        for i, b in enumerate(blocks)
    )
    system = f"""你是医学科普视频素材匹配专家。根据医生原话判断每个 logic block 是否需要医学动画。

可用类别：
{cat_summary}

判断标准——医生原话正在讲解：病理过程、生理机制、解剖结构、手术/检查过程、药物作用机制。
不需要的：观点、行动建议、叙事、误区纠正、号召。"""

    prompt = f"蓝图：{bp_title}\n\n{blocks_text}"
    schema = {
        "type": "object",
        "properties": {
            "matches": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "index": {"type": "integer"},
                        "needs_animation": {"type": "boolean"},
                        "category_id": {"type": "integer"},
                    },
                    "required": ["index", "needs_animation", "category_id"]
                }
            }
        },
        "required": ["matches"]
    }
    return call_claude(prompt, system, schema).get("matches", [])


def merge_consecutive_groups(blocks, anim_flags):
    """Merge consecutive ANIM blocks into groups."""
    groups = []
    current_group = None
    for i, (block, is_anim) in enumerate(zip(blocks, anim_flags)):
        if is_anim:
            if current_group is None:
                current_group = {"indices": [i], "blocks": [block]}
            else:
                current_group["indices"].append(i)
                current_group["blocks"].append(block)
        else:
            if current_group is not None:
                groups.append(current_group)
                current_group = None
    if current_group is not None:
        groups.append(current_group)
    return groups


def build_full_narration_for_asset(asset_file, asset_map):
    """Get full narration with timestamps for an asset."""
    asset = asset_map.get(asset_file)
    if not asset:
        return ""
    lines = []
    for s in asset.get("segments", []):
        text = s.get("text_en", "")
        if text and text != "you" and len(text) > 10:
            lines.append(f'[{s["start"]:.1f}-{s["end"]:.1f}s] {text}')
    return "\n".join(lines)


def step2_match_group(group, cat_passages, cat_map, asset_map):
    """Match a group of consecutive blocks to a continuous asset range."""
    # Combine atoms text
    combined_atoms = "\n".join(
        f'{b["seg_id"]}: {b["atoms_text"]}' for b in group["blocks"]
    )

    # Collect all candidate asset files from all categories of blocks in this group
    candidate_files = set()
    for b in group["blocks"]:
        cat_id = b.get("category_id", 0)
        for p in cat_passages.get(cat_id, []):
            candidate_files.add(p["file"])

    if not candidate_files:
        return None

    # Build full narration for each candidate asset
    asset_narrations = []
    for i, f in enumerate(sorted(candidate_files)):
        narration = build_full_narration_for_asset(f, asset_map)
        if narration:
            asset = asset_map.get(f, {})
            asset_narrations.append(
                f'--- Asset [{i}]: {asset.get("title", f)[:50]} ({asset.get("duration", 0):.0f}s) ---\n{narration}'
            )

    if not asset_narrations:
        return None

    assets_text = "\n\n".join(asset_narrations)

    system = """你是医学科普视频素材匹配专家。

任务：医生连续讲了一段医学机制（多个logic block），请从候选素材的完整英文旁白中，选出一段连续的时间范围，使其画面能覆盖医生讲述的整个过程。

关键规则：
1. 直接对比中文原话和英文旁白的语义，找同一个医学过程
2. 选择的时间范围要尽量覆盖医生讲的完整链条
3. 可以跨越素材内部的自然分段，只要内容连续相关
4. 如果没有合适匹配，matched设为false"""

    prompt = f"""医生连续讲述的内容（中文原话）：
{combined_atoms}

候选素材（英文旁白，带时间戳）：
{assets_text}"""

    schema = {
        "type": "object",
        "properties": {
            "matched": {"type": "boolean"},
            "asset_index": {"type": "integer", "description": "选中的素材编号，-1表示无匹配"},
            "start_sec": {"type": "number"},
            "end_sec": {"type": "number"},
            "reason": {"type": "string"}
        },
        "required": ["matched", "asset_index", "start_sec", "end_sec", "reason"]
    }

    result = call_claude(prompt, system, schema)

    if result.get("matched") and result.get("asset_index", -1) >= 0:
        ai = result["asset_index"]
        sorted_files = sorted(candidate_files)
        if ai < len(sorted_files):
            return {
                "file": sorted_files[ai],
                "title": asset_map.get(sorted_files[ai], {}).get("title", ""),
                "start": result["start_sec"],
                "end": result["end_sec"],
                "reason": result["reason"],
            }
    return None


def main():
    bp_path = Path(sys.argv[1])
    with open(bp_path, "r", encoding="utf-8") as f:
        bp = json.load(f)

    cat_map, cat_passages, asset_map = load_data()
    blocks = extract_blocks(bp)
    cat_summary = build_category_summary(cat_map, cat_passages)

    print(f"Blueprint: {bp['title']}")
    print(f"Blocks: {len(blocks)}")

    # Step 1: classify
    print("\nStep 1: Classifying...")
    t0 = time.time()
    matches = step1_classify(blocks, bp["title"], cat_summary)
    print(f"  Done in {time.time()-t0:.1f}s")

    # Build anim flags and attach category_id to blocks
    anim_flags = [False] * len(blocks)
    for m in matches:
        idx = m["index"]
        if idx < len(blocks) and m["needs_animation"] and m["category_id"] > 0:
            anim_flags[idx] = True
            blocks[idx]["category_id"] = m["category_id"]

    anim_count = sum(anim_flags)
    print(f"  {anim_count}/{len(blocks)} need animation")

    # Merge consecutive
    groups = merge_consecutive_groups(blocks, anim_flags)
    print(f"  Merged into {len(groups)} groups: {[len(g['blocks']) for g in groups]}")

    # Step 2: match each group
    results = []
    for gi, group in enumerate(groups):
        seg_ids = [b["seg_id"] for b in group["blocks"]]
        print(f"\nStep 2 Group {gi+1}: {seg_ids}")
        for b in group["blocks"]:
            print(f"  {b['seg_id']}: {b['atoms_text'][:80]}")

        t0 = time.time()
        pick = step2_match_group(group, cat_passages, cat_map, asset_map)
        elapsed = time.time() - t0

        if pick:
            print(f"  → {pick['title'][:40]} [{pick['start']:.0f}-{pick['end']:.0f}s] ({elapsed:.1f}s)")
            results.append({
                "seg_ids": seg_ids,
                "picked": pick,
            })
        else:
            print(f"  → NO MATCH ({elapsed:.1f}s)")
            results.append({
                "seg_ids": seg_ids,
                "picked": None,
            })

    # Save
    output = {
        "title": bp["title"],
        "groups": results,
        "all_blocks": [
            {"seg_id": b["seg_id"], "atoms_text": b["atoms_text"], "needs_animation": anim_flags[i]}
            for i, b in enumerate(blocks)
        ],
    }
    output_path = bp_path.parent / "asset_matches_v4.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    # Summary
    print("\n" + "=" * 70)
    for r in results:
        print(f"\n{' + '.join(r['seg_ids'])}")
        if r["picked"]:
            p = r["picked"]
            print(f"  → {p['title'][:50]} [{p['start']:.0f}-{p['end']:.0f}s]")
            print(f"    {p['reason'][:200]}")
        else:
            print(f"  → 无合适素材")

    print(f"\nOutput: {output_path}")


if __name__ == "__main__":
    main()
