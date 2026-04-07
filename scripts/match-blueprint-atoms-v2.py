# -*- coding: utf-8 -*-
"""Match blueprint to assets v2: continuous segment ranges, stricter quality.

Key changes from v1:
1. Assets presented as continuous narration passages, not isolated segments
2. Claude picks a time RANGE (start-end) within an asset, not single segments
3. No-narration segments excluded
4. Explicit "no good match" option — don't force-match

Usage:
  python scripts/match-blueprint-atoms-v2.py <blueprint.json>
"""

import json
import subprocess
import sys
import time
from pathlib import Path

CATEGORY_INDEX_PATH = Path("f:/AI total editing/editing V1/scripts/cluster_results/category_index.json")
ASSET_INDEX_PATH = Path("P:/团队空间/公司通用/AIkaifa/nucleus/cardiology/asset_index.json")


def load_category_index():
    with open(CATEGORY_INDEX_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    return {c["id"]: c for c in data["categories"]}


def load_asset_index():
    with open(ASSET_INDEX_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    asset_map = {}
    for a in data["assets"]:
        asset_map[a["file"]] = a
    return asset_map


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


def build_asset_passages(category: dict, asset_map: dict) -> list[dict]:
    """Group segments by file into continuous narration passages."""
    # Collect unique files in this category
    files_in_cat = {}
    for seg in category["segments"]:
        f = seg["file"]
        if f not in files_in_cat:
            files_in_cat[f] = True

    passages = []
    for file_key in files_in_cat:
        asset = asset_map.get(file_key)
        if not asset:
            continue

        # Get all segments with real narration
        good_segs = [s for s in asset.get("segments", [])
                     if s.get("text_en", "") and s["text_en"] != "you" and len(s["text_en"]) > 10]
        if not good_segs:
            continue

        # Build full narration text with timestamps
        narration_lines = []
        for s in good_segs:
            narration_lines.append(f'[{s["start"]:.1f}-{s["end"]:.1f}s] {s["text_en"][:150]}')

        passages.append({
            "file": file_key,
            "title": asset["title"],
            "duration": asset["duration"],
            "narration": "\n".join(narration_lines),
            "segments": good_segs,
        })

    return passages


def call_claude(prompt: str, system: str, schema: dict) -> dict:
    schema_str = json.dumps(schema, ensure_ascii=False)
    cmd = [
        "claude", "-p",
        "--model", "opus",
        "--output-format", "json",
        "--json-schema", schema_str,
        "--system-prompt", system,
        "--no-session-persistence",
        "-",  # read prompt from stdin
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


def step1_classify(blocks: list[dict], bp_title: str, cat_summary: str) -> list[dict]:
    blocks_text = "\n".join(
        f'[{i}] 场景「{b["scene_title"]}」\n'
        f'    医生原话: {b["atoms_text"][:200]}'
        for i, b in enumerate(blocks)
    )

    system = f"""你是医学科普视频素材匹配专家。根据医生的原话判断每个 logic block 是否需要医学动画素材。

可用类别（仅有素材的）：
{cat_summary}

判断标准——医生原话中正在**讲解**以下内容时才需要医学动画：
1. 病理过程 2. 生理机制 3. 解剖结构 4. 手术/检查过程 5. 药物作用机制

不需要的：观点、行动建议、故事叙述、误区纠正、号召转发、比喻说理（如"就像汽车踩油门"）。

关键：如果素材库中不太可能有合适的动画来展示医生所讲的具体内容，也应标记为不需要。"""

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
                        "category_id": {"type": "integer", "description": "类别ID，不需要时填0"},
                        "reason": {"type": "string"}
                    },
                    "required": ["index", "needs_animation", "category_id", "reason"]
                }
            }
        },
        "required": ["matches"]
    }

    return call_claude(prompt, system, schema).get("matches", [])


def step2_pick_range(block: dict, category: dict, asset_map: dict) -> dict:
    """Pick a time range from asset passages."""
    passages = build_asset_passages(category, asset_map)
    if not passages:
        return {}

    # Format passages for prompt
    passage_texts = []
    for i, p in enumerate(passages):
        passage_texts.append(f'\n--- 素材[{i}]: {p["title"]} ({p["duration"]:.0f}s) ---\n{p["narration"]}')

    all_passages = "\n".join(passage_texts)

    system = """你是医学科普视频素材匹配专家。

任务：根据医生的中文原话，从候选素材中选出画面最匹配的**一段连续时间范围**。

关键规则：
1. 中文的信息量通常比英文大，一段中文原话可能对应素材中连续多个segment，所以要选一个时间范围，不是单个segment
2. 选的时间范围内的旁白内容应该和医生所讲的医学过程/机制在**语义方向上一致**（比如医生在警告某药危险，就不要选介绍该药正面疗效的片段）
3. 不要选没有旁白的素材
4. 如果没有真正合适的匹配，matched设为false，不要硬凑"""

    prompt = f"""医生原话: {block['atoms_text']}
场景: {block['scene_title']}

候选素材：
{all_passages}"""

    schema = {
        "type": "object",
        "properties": {
            "matched": {"type": "boolean", "description": "是否找到合适匹配"},
            "passage_index": {"type": "integer", "description": "选中的素材编号，未匹配填-1"},
            "start_sec": {"type": "number", "description": "选中的起始时间（秒）"},
            "end_sec": {"type": "number", "description": "选中的结束时间（秒）"},
            "reason": {"type": "string", "description": "匹配理由"}
        },
        "required": ["matched", "passage_index", "start_sec", "end_sec", "reason"]
    }

    result = call_claude(prompt, system, schema)

    if result.get("matched") and result.get("passage_index", -1) >= 0:
        pi = result["passage_index"]
        if pi < len(passages):
            return {
                "file": passages[pi]["file"],
                "title": passages[pi]["title"],
                "start": result["start_sec"],
                "end": result["end_sec"],
                "reason": result["reason"],
            }
    return {}


def main():
    bp_path = Path(sys.argv[1])
    with open(bp_path, "r", encoding="utf-8") as f:
        bp = json.load(f)

    cat_map = load_category_index()
    asset_map = load_asset_index()
    blocks = extract_blocks_with_atoms(bp)
    cat_summary = build_category_summary(cat_map)

    print(f"Blueprint: {bp['title']}")
    print(f"Blocks: {len(blocks)}")

    # Step 1
    print("\nStep 1: Classifying...")
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
            "picked": None,
        }

        if m["needs_animation"] and m["category_id"] > 0:
            cat = cat_map.get(m["category_id"])
            if cat and cat["segments"]:
                entry["category_name"] = cat["name"]
                print(f"Step 2: {block['seg_id']} → {cat['name']}...")
                t0 = time.time()
                pick = step2_pick_range(block, cat, asset_map)
                elapsed = time.time() - t0
                if pick:
                    entry["picked"] = pick
                    print(f"  {elapsed:.1f}s → {pick['file'][:50]} [{pick['start']:.1f}-{pick['end']:.1f}s]")
                else:
                    print(f"  {elapsed:.1f}s → NO MATCH")

        results.append(entry)

    # Save
    output_path = bp_path.parent / "asset_matches_v2.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump({"title": bp["title"], "matches": results}, f, ensure_ascii=False, indent=2)

    # Print readable
    print("\n" + "=" * 70)
    for r in results:
        if r["needs_animation"]:
            print(f'\n{r["seg_id"]} [{r["scene_title"]}]')
            print(f'  【医生原话】{r["atoms_text"][:150]}')
            if r["picked"]:
                p = r["picked"]
                print(f'  → {p["file"][:55]}')
                print(f'    [{p["start"]:.1f}-{p["end"]:.1f}s] {p["reason"]}')
            else:
                print(f'  → 无合适素材')

    matched = sum(1 for r in results if r.get("picked"))
    need = sum(1 for r in results if r["needs_animation"])
    no_match = need - matched
    print(f"\nTotal: {len(results)} blocks, {need} need animation, {matched} matched, {no_match} gaps")
    print(f"Output: {output_path}")


if __name__ == "__main__":
    main()
