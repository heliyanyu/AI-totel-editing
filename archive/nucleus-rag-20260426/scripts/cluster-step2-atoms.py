# -*- coding: utf-8 -*-
"""Step 2 (atoms version): Merge labels into taxonomy."""

import json
import subprocess
from pathlib import Path
from collections import Counter

RESULTS_DIR = Path("f:/AI total editing/editing V1/scripts/cluster_atoms")
LABELS_PATH = RESULTS_DIR / "step1_all_labels.json"
TAXONOMY_PATH = RESULTS_DIR / "category_taxonomy.json"

SYSTEM_PROMPT = """你是医学科普视频素材分类专家。你的任务是把一批细粒度的医学动画标签合并聚类成语义类别。

这些标签来自医生口播原文的分析，比较具体（如"纤维帽在情绪激动时破裂"），你需要：

1. 将语义相近的标签归入同一类别
2. 类别名称要具体到单一过程/机制，但不要太碎（同一过程的不同讲法应合并）
3. 类别名称用中文，简洁明确
4. 数量控制在80-150个
5. 每个类别给出简短描述

分类体系应覆盖五大领域：病理过程、生理机制、解剖结构、手术检查、药物机制"""


def call_claude(prompt: str, system: str, schema: dict) -> dict:
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
        capture_output=True, text=True, encoding="utf-8", timeout=1200,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ERROR: {result.stderr[:500]}")
    response = json.loads(result.stdout)
    if "structured_output" in response:
        return response["structured_output"]
    return response


def main():
    with open(LABELS_PATH, "r", encoding="utf-8") as f:
        all_results = json.load(f)

    labels = [r["label"] for r in all_results if r["needs_animation"] and r["label"]]
    counter = Counter(labels)
    all_labels = list(counter.most_common())

    schema = {
        "type": "object",
        "properties": {
            "categories": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "integer"},
                        "name": {"type": "string"},
                        "description": {"type": "string"},
                        "domain": {
                            "type": "string",
                            "enum": ["病理过程", "生理机制", "解剖结构", "手术检查", "药物机制"]
                        },
                        "merged_labels": {
                            "type": "array",
                            "items": {"type": "string"}
                        }
                    },
                    "required": ["id", "name", "description", "domain", "merged_labels"]
                }
            }
        },
        "required": ["categories"]
    }

    # Split into 4 chunks to avoid timeout
    chunk_size = (len(all_labels) + 3) // 4
    halves = [all_labels[i:i+chunk_size] for i in range(0, len(all_labels), chunk_size)]
    all_cats = []
    cat_id = 1

    import time
    n_chunks = len(halves)
    for half_idx, half in enumerate(halves):
        chunk_file = RESULTS_DIR / f"step2_chunk_{half_idx}.json"

        # Skip if already done
        if chunk_file.exists():
            print(f"Batch {half_idx+1}/{n_chunks}: Already done, loading...")
            with open(chunk_file, "r", encoding="utf-8") as f:
                cats = json.load(f)
            for c in cats:
                c["id"] = cat_id
                cat_id += 1
            all_cats.extend(cats)
            continue

        labels_text = "\n".join(f"- {label} (×{count})" for label, count in half)
        prompt = f"""以下是第 {half_idx+1}/{n_chunks} 批，共 {len(half)} 个细粒度医学动画标签（基于医生口播原文）。
请将它们聚类合并成语义类别。类别编号从 {cat_id} 开始。

{labels_text}"""

        print(f"Batch {half_idx+1}/{n_chunks}: {len(half)} labels...")
        t0 = time.time()
        result = call_claude(prompt, SYSTEM_PROMPT, schema)
        cats = result.get("categories", [])

        # Save chunk
        with open(chunk_file, "w", encoding="utf-8") as f:
            json.dump(cats, f, ensure_ascii=False, indent=2)

        for c in cats:
            c["id"] = cat_id
            cat_id += 1
        all_cats.extend(cats)
        print(f"  Done in {time.time()-t0:.1f}s — {len(cats)} categories")

    # Save
    taxonomy = {"categories": all_cats}
    with open(TAXONOMY_PATH, "w", encoding="utf-8") as f:
        json.dump(taxonomy, f, ensure_ascii=False, indent=2)

    print(f"\nTotal: {len(all_cats)} categories")

    from collections import Counter as C2
    domains = C2(c["domain"] for c in all_cats)
    for d, cnt in domains.most_common():
        print(f"  {d}: {cnt}")

    all_merged = set()
    for c in all_cats:
        all_merged.update(c.get("merged_labels", []))
    uncovered = set(counter.keys()) - all_merged
    if uncovered:
        print(f"\nWARNING: {len(uncovered)} labels not covered")
    else:
        print(f"\nAll {len(counter)} labels covered.")

    print(f"Output: {TAXONOMY_PATH}")


if __name__ == "__main__":
    main()
