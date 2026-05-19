# -*- coding: utf-8 -*-
"""Match blueprint to assets v3: uses semantic passages instead of raw segments.

Two-step:
1. Classify blocks (atoms text) → categories
2. For each matched block, pick best passage from that category

Usage:
  python scripts/match-blueprint-v3.py <blueprint.json>
"""

import json
import subprocess
import sys
import time
from pathlib import Path
from collections import defaultdict

TAXONOMY_PATH = Path("f:/AI total editing/editing V1/scripts/cluster_atoms/category_taxonomy_deduped.json")
PASSAGES_PATH = Path("f:/AI total editing/editing V1/scripts/cluster_atoms/logic_block_categories.json")


def load_data():
    with open(TAXONOMY_PATH, "r", encoding="utf-8") as f:
        taxonomy = json.load(f)
    cat_map = {c["id"]: c for c in taxonomy["categories"]}

    with open(PASSAGES_PATH, "r", encoding="utf-8") as f:
        passages = json.load(f)

    # Build category_id -> passages lookup
    cat_passages = defaultdict(list)
    for p in passages:
        for cid in p.get("category_ids", []):
            cat_passages[cid].append(p)

    return cat_map, cat_passages


def extract_blocks(bp: dict) -> list[dict]:
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


def build_category_summary(cat_map, cat_passages):
    lines = []
    for cid in sorted(cat_map.keys()):
        c = cat_map[cid]
        n = len(cat_passages.get(cid, []))
        if n > 0:
            lines.append(f'{cid:3d}. {c["name"]} — {c["description"]} ({n}个段落)')
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
        f'[{i}] 场景「{b["scene_title"]}」\n'
        f'    医生原话: {b["atoms_text"][:200]}'
        for i, b in enumerate(blocks)
    )

    system = f"""你是医学科普视频素材匹配专家。根据医生原话判断每个 logic block 是否可以配医学动画素材。

可用类别（仅有素材段落的）：
{cat_summary}

判断原则——宁多勿少，只要医生原话中**涉及**以下任何一项就标记为需要：
1. 提到了具体的解剖结构（心脏、冠状动脉、血管、心肌、肾脏…）
2. 提到了病理过程（斑块、血栓、堵塞、坏死、缺血、破裂…）
3. 提到了生理机制（泵血、供血、耗氧、血压、代谢…）
4. 提到了手术/检查（支架、造影、球囊、心电图…）
5. 提到了药物作用（他汀、降压药、硝酸甘油、阿司匹林…）

只有以下情况标记为不需要：
- 纯粹的情感号召（"转发给家人"）
- 纯粹的数字强调（"1/2"）
- 纯粹的行动指令且不涉及医学概念（"打120"、"去医院"）
- 纯粹的叙事过渡（"接下来我们讲"）"""

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
                        "reason": {"type": "string"}
                    },
                    "required": ["index", "needs_animation", "category_id", "reason"]
                }
            }
        },
        "required": ["matches"]
    }

    return call_claude(prompt, system, schema).get("matches", [])


def step2_pick_passage(block, passages_in_cat, cat_name):
    """Pick best passage from category using atoms text vs passage summary."""
    passage_lines = []
    for i, p in enumerate(passages_in_cat):
        passage_lines.append(
            f'[{i}] {p["title"][:40]} [{p["start_sec"]:.0f}-{p["end_sec"]:.0f}s]\n'
            f'    English narration: {p.get("text_en", "")[:300]}'
        )

    passages_text = "\n".join(passage_lines)

    system = """你是医学科普视频素材匹配专家。

任务：根据医生的中文原话，从候选素材段落（英文旁白）中选出最匹配的一个。

关键规则：
1. 直接对比中文原话和英文旁白的语义内容，判断它们是否在讲同一个医学过程/机制
2. 语义方向要一致（不能一个在讲正面效果一个在讲副作用）
3. 如果没有真正合适的匹配，matched设为false
4. 每个段落已经是一个完整的语义单元，直接选即可"""

    prompt = f"""医生中文原话: {block['atoms_text']}
场景: {block['scene_title']}
类别: {cat_name}

候选素材段落（英文旁白，共{len(passages_in_cat)}个）：
{passages_text}"""

    schema = {
        "type": "object",
        "properties": {
            "matched": {"type": "boolean"},
            "passage_index": {"type": "integer", "description": "-1 if not matched"},
            "reason": {"type": "string"}
        },
        "required": ["matched", "passage_index", "reason"]
    }

    return call_claude(prompt, system, schema)


def main():
    bp_path = Path(sys.argv[1])
    with open(bp_path, "r", encoding="utf-8") as f:
        bp = json.load(f)

    cat_map, cat_passages = load_data()
    blocks = extract_blocks(bp)
    cat_summary = build_category_summary(cat_map, cat_passages)

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
            passages = cat_passages.get(m["category_id"], [])
            if cat and passages:
                entry["category_name"] = cat["name"]
                print(f"Step 2: {block['seg_id']} → {cat['name']} ({len(passages)} passages)...")
                t0 = time.time()
                pick = step2_pick_passage(block, passages, cat["name"])
                elapsed = time.time() - t0

                if pick.get("matched") and pick.get("passage_index", -1) >= 0:
                    pi = pick["passage_index"]
                    if pi < len(passages):
                        p = passages[pi]
                        entry["picked"] = {
                            "file": p["file"],
                            "title": p["title"],
                            "start": p["start_sec"],
                            "end": p["end_sec"],
                            "text_en": p.get("text_en", "")[:200],
                            "reason": pick["reason"],
                        }
                        print(f"  {elapsed:.1f}s → {p['title'][:40]} [{p['start_sec']:.0f}-{p['end_sec']:.0f}s]")
                    else:
                        print(f"  {elapsed:.1f}s → NO MATCH (index out of range)")
                else:
                    print(f"  {elapsed:.1f}s → NO MATCH")

        results.append(entry)

    # Save
    output_path = bp_path.parent / "asset_matches_v3.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump({"title": bp["title"], "matches": results}, f, ensure_ascii=False, indent=2)

    # Print summary
    print("\n" + "=" * 70)
    for r in results:
        if r["needs_animation"]:
            print(f'\n{r["seg_id"]} [{r["scene_title"]}]')
            print(f'  【医生原话】{r["atoms_text"][:150]}')
            if r["picked"]:
                p = r["picked"]
                print(f'  → {p["title"][:50]} [{p["start"]:.0f}-{p["end"]:.0f}s]')
                print(f'    旁白: {p.get("text_en", "")[:120]}')
                print(f'    理由: {p["reason"]}')
            else:
                print(f'  → 无合适素材')

    matched = sum(1 for r in results if r.get("picked"))
    need = sum(1 for r in results if r["needs_animation"])
    print(f"\nTotal: {len(results)} blocks, {need} need animation, {matched} matched, {need-matched} gaps")
    print(f"Output: {output_path}")


if __name__ == "__main__":
    main()
