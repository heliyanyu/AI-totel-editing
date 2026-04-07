# -*- coding: utf-8 -*-
"""Match blueprint to assets using atoms text (original narration) instead of items.

Single-shot: sends all blocks with atoms text to Claude, gets category + segment picks.

Usage:
  python scripts/match-blueprint-atoms.py <blueprint.json>
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


def extract_blocks_with_atoms(bp: dict) -> list[dict]:
    blocks = []
    for scene in bp["scenes"]:
        for seg in scene.get("logic_segments", []):
            items = [item["text"] for item in seg.get("items", [])]
            keep_atoms = [a for a in seg.get("atoms", []) if a.get("status") == "keep"]
            atoms_text = " ".join(a["text"] for a in keep_atoms)
            blocks.append({
                "seg_id": seg["id"],
                "scene_title": scene["title"],
                "template": seg["template"],
                "items": items,
                "atoms_text": atoms_text,
            })
    return blocks


def build_category_summary(cat_map: dict) -> str:
    lines = []
    for cid in sorted(cat_map.keys()):
        c = cat_map[cid]
        if c["segments"]:
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


def step1_classify(blocks: list[dict], bp_title: str, cat_summary: str) -> list[dict]:
    blocks_text = "\n".join(
        f'[{i}] 场景「{b["scene_title"]}」\n'
        f'    items概括: {" | ".join(b["items"])}\n'
        f'    医生原话: {b["atoms_text"][:200]}'
        for i, b in enumerate(blocks)
    )

    system = f"""你是医学科普视频素材匹配专家。判断每个 logic block 是否需要医学动画素材。

重要：请根据「医生原话」来判断，不要依赖「items概括」，因为概括可能不准确。

可用类别（仅有素材的）：
{cat_summary}

判断标准——医生原话中正在讲解以下内容时才需要医学动画：
1. 病理过程 2. 生理机制 3. 解剖结构 4. 手术/检查过程 5. 药物作用机制

医生在发表观点、给行动建议、讲故事、纠正误区、号召转发等 → 不需要动画。"""

    prompt = f"""蓝图：{bp_title}

{blocks_text}"""

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
                        "category_id": {"type": "integer", "description": "类别ID，不需要时填0"},
                        "reason": {"type": "string", "description": "简短理由"}
                    },
                    "required": ["index", "needs_animation", "category_id", "reason"]
                }
            }
        },
        "required": ["matches"]
    }

    return call_claude(prompt, system, schema).get("matches", [])


def step2_pick(block: dict, category: dict) -> list[dict]:
    seg_lines = []
    for i, seg in enumerate(category["segments"]):
        text = seg.get("text_en", "")
        if not text or text == "you":
            text = f"(无旁白, 视频: {seg['title']})"
        else:
            text = text[:150]
        seg_lines.append(f'[{i}] {seg["file"][:60]} [{seg["start"]:.1f}-{seg["end"]:.1f}s] {text}')

    segs_text = "\n".join(seg_lines)

    system = """你是医学科普视频素材匹配专家。根据医生的原话内容，从候选片段中选出画面最匹配的1-3个。

关键：要匹配的是画面内容，不只是关键词。医生在讲什么医学过程，素材的动画是否在展示同一个过程。"""

    prompt = f"""医生原话: {block['atoms_text']}
场景: {block['scene_title']}
类别: {category['name']}

候选片段（共{len(category['segments'])}个）：
{segs_text}"""

    schema = {
        "type": "object",
        "properties": {
            "picks": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "segment_index": {"type": "integer"},
                        "relevance": {"type": "string", "description": "匹配理由"}
                    },
                    "required": ["segment_index", "relevance"]
                }
            }
        },
        "required": ["picks"]
    }

    return call_claude(prompt, system, schema).get("picks", [])


def main():
    bp_path = Path(sys.argv[1])
    with open(bp_path, "r", encoding="utf-8") as f:
        bp = json.load(f)

    cat_map = load_category_index()
    blocks = extract_blocks_with_atoms(bp)
    cat_summary = build_category_summary(cat_map)

    print(f"Blueprint: {bp['title']}")
    print(f"Blocks: {len(blocks)}")

    # Step 1
    print("\nStep 1: Classifying (using atoms text)...")
    t0 = time.time()
    matches = step1_classify(blocks, bp["title"], cat_summary)
    print(f"  Done in {time.time()-t0:.1f}s")

    anim = [m for m in matches if m["needs_animation"] and m["category_id"] > 0]
    print(f"  {len(anim)}/{len(blocks)} need animation")

    # Step 2
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
            "atoms_text": block["atoms_text"],
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
                print(f"Step 2: {block['seg_id']} → {cat['name']}...")
                t0 = time.time()
                picks = step2_pick(block, cat)
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

    # Output comparison
    output_path = bp_path.parent / "asset_matches_atoms.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump({"title": bp["title"], "matches": results}, f, ensure_ascii=False, indent=2)

    # Print readable output
    print("\n" + "=" * 70)
    for r in results:
        if r["needs_animation"]:
            print(f'\n{r["seg_id"]} [{r["scene_title"]}]')
            print(f'  【医生原话】{r["atoms_text"][:120]}')
            print(f'  【items概括】{" → ".join(r["items"])}')
            print(f'  → 类别: {r["category_name"] or "无匹配"}')
            for ps in r["picked_segments"]:
                print(f'  → 素材: {ps["file"][:55]} [{ps["start"]:.1f}-{ps["end"]:.1f}s]')
                print(f'    旁白: {ps["text_en"][:100]}')
                print(f'    理由: {ps["relevance"]}')

    matched = sum(1 for r in results if r["picked_segments"])
    need = sum(1 for r in results if r["needs_animation"])
    print(f"\nTotal: {len(results)} blocks, {need} need animation, {matched} matched")
    print(f"Output: {output_path}")


if __name__ == "__main__":
    main()
