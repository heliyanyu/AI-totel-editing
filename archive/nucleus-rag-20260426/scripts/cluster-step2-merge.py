# -*- coding: utf-8 -*-
"""Step 2: Merge 773 raw labels into ~100 category taxonomy via Claude CLI.

Reads step1_all_labels.json, sends all unique labels to Claude for clustering,
outputs category_taxonomy.json.
"""

import json
import subprocess
from pathlib import Path

RESULTS_DIR = Path("f:/AI total editing/editing V1/scripts/cluster_results")
LABELS_PATH = RESULTS_DIR / "step1_all_labels.json"
TAXONOMY_PATH = RESULTS_DIR / "category_taxonomy.json"

SYSTEM_PROMPT = """你是医学科普视频素材分类专家。你的任务是把一批细粒度的医学动画标签合并聚类成约100个语义类别。

聚类原则：
1. 同一个医学过程/机制的不同表述应合并（如"动脉粥样硬化斑块形成过程"和"LDL在血管壁沉积形成斑块"是同一类）
2. 类别名称要具体到单一过程/机制/结构，不要太笼统（"心血管疾病"太粗）
3. 类别名称要中文，简洁明确，适合作为素材库的索引标签
4. 数量控制在80-120个左右，太细的合并，太粗的拆开
5. 每个类别给出简短描述，说明这个类别覆盖什么内容

分类体系应覆盖以下五大领域：
- 病理过程
- 生理机制
- 解剖结构
- 手术/检查过程
- 药物作用机制"""

def main():
    with open(LABELS_PATH, "r", encoding="utf-8") as f:
        all_results = json.load(f)

    # Collect unique labels with counts
    from collections import Counter
    labels = [r["label"] for r in all_results if r["needs_animation"] and r["label"]]
    counter = Counter(labels)

    # Format labels for prompt
    labels_text = "\n".join(f"- {label} (×{count})" for label, count in counter.most_common())

    prompt = f"""以下是从 4424 个视频蓝图 logic block 中提取出的 {len(counter)} 个细粒度医学动画标签（附出现次数）。
请将它们聚类合并成约 100 个语义类别。

{labels_text}

请输出分类目录。"""

    schema = {
        "type": "object",
        "properties": {
            "categories": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {
                            "type": "integer",
                            "description": "类别编号，从1开始"
                        },
                        "name": {
                            "type": "string",
                            "description": "类别名称"
                        },
                        "description": {
                            "type": "string",
                            "description": "类别覆盖范围描述"
                        },
                        "domain": {
                            "type": "string",
                            "enum": ["病理过程", "生理机制", "解剖结构", "手术检查", "药物机制"],
                            "description": "所属领域"
                        },
                        "merged_labels": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "归入此类别的原始标签列表"
                        }
                    },
                    "required": ["id", "name", "description", "domain", "merged_labels"]
                }
            }
        },
        "required": ["categories"]
    }

    schema_str = json.dumps(schema, ensure_ascii=False)

    print(f"Sending {len(counter)} unique labels to Claude for clustering...")

    cmd = [
        "claude", "-p",
        "--model", "opus",
        "--output-format", "json",
        "--json-schema", schema_str,
        "--system-prompt", SYSTEM_PROMPT,
        "--no-session-persistence",
        prompt
    ]

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=600,
    )

    if result.returncode != 0:
        print(f"ERROR: {result.stderr[:500]}")
        return

    response = json.loads(result.stdout)
    taxonomy = response.get("structured_output", response)

    # Save taxonomy
    with open(TAXONOMY_PATH, "w", encoding="utf-8") as f:
        json.dump(taxonomy, f, ensure_ascii=False, indent=2)

    cats = taxonomy.get("categories", [])
    print(f"\nDone! {len(cats)} categories created.")

    # Stats by domain
    from collections import Counter as C2
    domains = C2(c["domain"] for c in cats)
    for d, cnt in domains.most_common():
        print(f"  {d}: {cnt}")

    # Check coverage
    all_merged = set()
    for c in cats:
        all_merged.update(c.get("merged_labels", []))
    uncovered = set(counter.keys()) - all_merged
    if uncovered:
        print(f"\nWARNING: {len(uncovered)} labels not covered by any category")
    else:
        print(f"\nAll {len(counter)} labels covered.")

    print(f"Output: {TAXONOMY_PATH}")


if __name__ == "__main__":
    main()
