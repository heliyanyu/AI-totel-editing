# -*- coding: utf-8 -*-
"""Deduplicate the 212 categories from 4-batch clustering into ~100-150."""

import json
import subprocess
from pathlib import Path

RESULTS_DIR = Path("f:/AI total editing/editing V1/scripts/cluster_atoms")
INPUT_PATH = RESULTS_DIR / "category_taxonomy.json"
OUTPUT_PATH = RESULTS_DIR / "category_taxonomy_deduped.json"

SYSTEM_PROMPT = """你是分类学专家。以下是分 4 批聚类产出的 212 个医学动画类别，因为分批处理导致很多重复。

请合并去重：
1. 语义相同或高度重叠的类别合并为一个
2. 合并时保留最好的名称，merged_labels 取并集
3. 最终控制在 100-150 个类别
4. 保持 id 连续编号从 1 开始
5. domain 保持不变"""


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
        capture_output=True, text=True, encoding="utf-8", timeout=1200,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ERROR: {result.stderr[:500]}")
    response = json.loads(result.stdout)
    if "structured_output" in response:
        return response["structured_output"]
    return response


def main():
    with open(INPUT_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    cats = data["categories"]
    # Format compact: id, name, domain, label count
    cat_lines = []
    for c in cats:
        cat_lines.append(f'{c["id"]}. [{c["domain"]}] {c["name"]} — {c["description"]} (labels: {", ".join(c["merged_labels"][:5])}{"..." if len(c["merged_labels"]) > 5 else ""})')

    prompt = f"""以下是 {len(cats)} 个类别，请合并去重：

""" + "\n".join(cat_lines)

    schema = {
        "type": "object",
        "properties": {
            "merges": {
                "type": "array",
                "description": "合并指令列表",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string", "description": "合并后的类别名称"},
                        "description": {"type": "string"},
                        "domain": {"type": "string", "enum": ["病理过程", "生理机制", "解剖结构", "手术检查", "药物机制"]},
                        "source_ids": {"type": "array", "items": {"type": "integer"}, "description": "被合并的原始类别ID列表"}
                    },
                    "required": ["name", "description", "domain", "source_ids"]
                }
            }
        },
        "required": ["merges"]
    }

    print(f"Sending {len(cats)} categories for dedup...")
    import time
    t0 = time.time()
    result = call_claude(prompt, SYSTEM_PROMPT, schema)
    print(f"Done in {time.time()-t0:.1f}s")

    merges = result.get("merges", [])

    # Build source_id -> category lookup
    cat_by_id = {c["id"]: c for c in cats}

    # Build deduped categories
    deduped = []
    for i, m in enumerate(merges):
        merged_labels = []
        for sid in m["source_ids"]:
            if sid in cat_by_id:
                merged_labels.extend(cat_by_id[sid].get("merged_labels", []))
        deduped.append({
            "id": i + 1,
            "name": m["name"],
            "description": m["description"],
            "domain": m["domain"],
            "merged_labels": list(set(merged_labels)),  # deduplicate labels too
        })

    output = {"categories": deduped}
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    from collections import Counter
    domains = Counter(c["domain"] for c in deduped)
    print(f"Result: {len(deduped)} categories")
    for d, cnt in domains.most_common():
        print(f"  {d}: {cnt}")
    print(f"Output: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
