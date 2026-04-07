# -*- coding: utf-8 -*-
"""Match a single blueprint's logic blocks to Nucleus assets via category index.

Two-step matching:
  1. Classify each logic block → category (lightweight)
  2. For blocks with a category match, pick best segment from that category

Usage:
  python scripts/match-blueprint-assets.py <blueprint.json>
"""

import json
import subprocess
import sys
import time
from pathlib import Path

CATEGORY_INDEX_PATH = Path("f:/AI total editing/editing V1/scripts/cluster_results/category_index.json")


def load_category_index():
    with open(CATEGORY_INDEX_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    return {c["id"]: c for c in data["categories"]}


def extract_blocks(bp: dict) -> list[dict]:
    blocks = []
    for scene in bp["scenes"]:
        for seg in scene.get("logic_segments", []):
            items = [item["text"] for item in seg.get("items", [])]
            blocks.append({
                "seg_id": seg["id"],
                "scene_title": scene["title"],
                "template": seg["template"],
                "items": items,
            })
    return blocks


def build_category_summary(cat_map: dict) -> str:
    lines = []
    for cid in sorted(cat_map.keys()):
        c = cat_map[cid]
        if c["segments"]:  # only show categories that have assets
            lines.append(f'{cid:3d}. {c["name"]} — {c["description"]} ({len(c["segments"])}个片段)')
    return "\n".join(lines)


def call_claude(prompt: str, system: str, schema: dict) -> dict:
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
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", timeout=300)
    if result.returncode != 0:
        raise RuntimeError(f"claude CLI failed: {result.stderr[:500]}")
    response = json.loads(result.stdout)
    if "structured_output" in response:
        return response["structured_output"]
    return response


def step1_classify_blocks(blocks: list[dict], cat_summary: str) -> list[dict]:
    """Classify blocks into categories."""
    blocks_text = "\n".join(
        f'[{i}] 场景「{b["scene_title"]}」模板:{b["template"]} | {" | ".join(b["items"])}'
        for i, b in enumerate(blocks)
    )

    system = f"""你是医学科普视频素材匹配专家。判断每个 logic block 是否需要医学动画素材，如果需要，匹配到最合适的类别。

可用类别（仅列出有素材的类别）：
{cat_summary}

判断标准——内容涉及以下才需要医学动画：
1. 病理过程 2. 生理机制 3. 解剖结构 4. 手术/检查过程 5. 药物作用机制

观点、金句、数字强调、生活建议、误区纠正的逻辑对比 → 不需要动画。"""

    prompt = f"""蓝图标题：{blocks[0].get('bp_title', '')}

以下是该蓝图的所有 logic block，请逐个判断：
{blocks_text}"""

    # Add bp_title to blocks for prompt
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
                        "category_id": {"type": "integer", "description": "匹配的类别ID，不需要动画时填0"},
                        "reason": {"type": "string", "description": "简短理由，10字以内"}
                    },
                    "required": ["index", "needs_animation", "category_id", "reason"]
                }
            }
        },
        "required": ["matches"]
    }

    return call_claude(prompt, system, schema).get("matches", [])


def step2_pick_segments(block: dict, category: dict) -> list[dict]:
    """Pick best segments from a category for a specific block."""
    # Format available segments
    seg_lines = []
    for i, seg in enumerate(category["segments"]):
        text = seg.get("text_en", "")
        if not text or text == "you":
            text = f"(无旁白, 视频: {seg['title']})"
        else:
            text = text[:120]
        seg_lines.append(f'[{i}] {seg["file"][:60]} [{seg["start"]:.1f}-{seg["end"]:.1f}s] {text}')

    segs_text = "\n".join(seg_lines)
    items_text = " | ".join(block["items"])

    system = """你是医学科普视频素材匹配专家。从候选片段中选出最匹配的1-3个。
优先选择有英文旁白且内容直接对应的片段。
如果没有好的匹配，返回空数组。"""

    prompt = f"""Logic block: 场景「{block['scene_title']}」| {items_text}
类别：{category['name']}

候选片段（共{len(category['segments'])}个）：
{segs_text}

请选出最匹配的片段。"""

    schema = {
        "type": "object",
        "properties": {
            "picks": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "segment_index": {"type": "integer"},
                        "relevance": {"type": "string", "description": "简述匹配理由，15字以内"}
                    },
                    "required": ["segment_index", "relevance"]
                }
            }
        },
        "required": ["picks"]
    }

    return call_claude(prompt, system, schema).get("picks", [])


def main():
    if len(sys.argv) < 2:
        print("Usage: python scripts/match-blueprint-assets.py <blueprint.json>")
        sys.exit(1)

    bp_path = Path(sys.argv[1])
    with open(bp_path, "r", encoding="utf-8") as f:
        bp = json.load(f)

    cat_map = load_category_index()
    blocks = extract_blocks(bp)

    # Add bp_title
    for b in blocks:
        b["bp_title"] = bp["title"]

    print(f"Blueprint: {bp['title']}")
    print(f"Logic blocks: {len(blocks)}")
    print(f"Categories with assets: {sum(1 for c in cat_map.values() if c['segments'])}")
    print()

    # Step 1: classify
    cat_summary = build_category_summary(cat_map)
    print("Step 1: Classifying blocks...")
    t0 = time.time()
    matches = step1_classify_blocks(blocks, cat_summary)
    print(f"  Done in {time.time()-t0:.1f}s")

    anim_blocks = [m for m in matches if m["needs_animation"] and m["category_id"] > 0]
    print(f"  {len(anim_blocks)}/{len(blocks)} blocks need animation")
    print()

    # Step 2: pick segments for each matched block
    results = []
    for m in matches:
        idx = m["index"]
        if idx >= len(blocks):
            continue
        block = blocks[idx]
        entry = {
            "seg_id": block["seg_id"],
            "scene_title": block["scene_title"],
            "items": block["items"],
            "needs_animation": m["needs_animation"],
            "category_id": m["category_id"],
            "category_name": "",
            "reason": m["reason"],
            "picked_segments": [],
        }

        if m["needs_animation"] and m["category_id"] > 0:
            cat = cat_map.get(m["category_id"])
            if cat and cat["segments"]:
                entry["category_name"] = cat["name"]
                print(f"Step 2: {block['seg_id']} → {cat['name']} ({len(cat['segments'])} candidates)...")
                t0 = time.time()
                picks = step2_pick_segments(block, cat)
                print(f"  Done in {time.time()-t0:.1f}s, picked {len(picks)}")

                for p in picks:
                    si = p["segment_index"]
                    if si < len(cat["segments"]):
                        seg = cat["segments"][si]
                        entry["picked_segments"].append({
                            "file": seg["file"],
                            "start": seg["start"],
                            "end": seg["end"],
                            "text_en": seg.get("text_en", "")[:150],
                            "relevance": p["relevance"],
                        })

        results.append(entry)

    # Save results
    output_path = bp_path.parent / "asset_matches.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump({"title": bp["title"], "matches": results}, f, ensure_ascii=False, indent=2)

    # Print summary
    print()
    print("=" * 70)
    print(f"MATCHING RESULTS: {bp['title']}")
    print("=" * 70)
    for r in results:
        items_str = " | ".join(r["items"])[:60]
        if r["needs_animation"] and r["picked_segments"]:
            print(f"  {r['seg_id']:8s} [{r['scene_title']}] {items_str}")
            print(f"           → {r['category_name']}")
            for ps in r["picked_segments"]:
                print(f"             {ps['file'][:50]} [{ps['start']:.1f}-{ps['end']:.1f}s] {ps['relevance']}")
        elif r["needs_animation"]:
            print(f"  {r['seg_id']:8s} [{r['scene_title']}] {items_str}")
            print(f"           → {r['category_name'] or 'NO MATCH'} (no segments)")
        # skip non-animation blocks in output

    matched = sum(1 for r in results if r["picked_segments"])
    need_anim = sum(1 for r in results if r["needs_animation"])
    print(f"\nTotal: {len(results)} blocks, {need_anim} need animation, {matched} matched with segments")
    print(f"Output: {output_path}")


if __name__ == "__main__":
    main()
