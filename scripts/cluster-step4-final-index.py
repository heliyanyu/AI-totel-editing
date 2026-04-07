# -*- coding: utf-8 -*-
"""Step 4: Build final category → segments index.

Combines taxonomy + segment assignments into a single usable index.
Also generates stats on coverage.
"""

import json
from collections import defaultdict
from pathlib import Path

TAXONOMY_PATH = Path("f:/AI total editing/editing V1/scripts/cluster_results/category_taxonomy.json")
SEGMENTS_PATH = Path("f:/AI total editing/editing V1/scripts/cluster_results/segment_categories.json")
STEP1_PATH = Path("f:/AI total editing/editing V1/scripts/cluster_results/step1_all_labels.json")
OUTPUT_PATH = Path("f:/AI total editing/editing V1/scripts/cluster_results/category_index.json")
STATS_PATH = Path("f:/AI total editing/editing V1/scripts/cluster_results/final_stats.txt")


def main():
    with open(TAXONOMY_PATH, "r", encoding="utf-8") as f:
        taxonomy = json.load(f)
    with open(SEGMENTS_PATH, "r", encoding="utf-8") as f:
        segments = json.load(f)
    with open(STEP1_PATH, "r", encoding="utf-8") as f:
        step1 = json.load(f)

    # Build category map
    cat_map = {}
    for c in taxonomy["categories"]:
        cat_map[c["id"]] = {
            "id": c["id"],
            "name": c["name"],
            "description": c["description"],
            "domain": c["domain"],
            "segments": [],
            "logic_block_count": 0,
        }

    # Assign segments to categories
    for seg in segments:
        for cid in seg.get("category_ids", []):
            if cid in cat_map:
                cat_map[cid]["segments"].append({
                    "file": seg["file"],
                    "title": seg["title"],
                    "start": seg["start"],
                    "end": seg["end"],
                    "text_en": seg.get("text_en", ""),
                })

    # Count logic blocks per category (from step1 labels → taxonomy merged_labels)
    label_to_cat = {}
    for c in taxonomy["categories"]:
        for label in c.get("merged_labels", []):
            label_to_cat[label] = c["id"]

    for block in step1:
        if block.get("needs_animation") and block.get("label"):
            cid = label_to_cat.get(block["label"])
            if cid and cid in cat_map:
                cat_map[cid]["logic_block_count"] += 1

    # Sort categories by id
    categories = sorted(cat_map.values(), key=lambda c: c["id"])

    # Output
    output = {"categories": categories}
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    # Stats
    lines = []
    lines.append("=" * 80)
    lines.append("CATEGORY INDEX — FINAL STATISTICS")
    lines.append("=" * 80)
    lines.append(f"Total categories: {len(categories)}")
    lines.append(f"Total segments assigned: {sum(len(c['segments']) for c in categories)}")
    lines.append(f"Total logic blocks needing animation: {sum(c['logic_block_count'] for c in categories)}")
    lines.append("")

    # Coverage
    cats_with_segs = [c for c in categories if c["segments"]]
    cats_without_segs = [c for c in categories if not c["segments"]]
    cats_with_blocks = [c for c in categories if c["logic_block_count"] > 0]

    lines.append(f"Categories with segments: {len(cats_with_segs)}/{len(categories)}")
    lines.append(f"Categories with logic blocks: {len(cats_with_blocks)}/{len(categories)}")
    lines.append("")

    # Domain breakdown
    from collections import Counter
    domain_stats = defaultdict(lambda: {"cats": 0, "segs": 0, "blocks": 0})
    for c in categories:
        d = c["domain"]
        domain_stats[d]["cats"] += 1
        domain_stats[d]["segs"] += len(c["segments"])
        domain_stats[d]["blocks"] += c["logic_block_count"]

    lines.append(f"{'Domain':<12} {'Cats':>5} {'Segs':>6} {'Blocks':>7}")
    lines.append("-" * 35)
    for d in ["病理过程", "生理机制", "解剖结构", "手术检查", "药物机制"]:
        s = domain_stats[d]
        lines.append(f"{d:<12} {s['cats']:>5} {s['segs']:>6} {s['blocks']:>7}")

    # Detailed per category
    lines.append("")
    lines.append("=" * 80)
    lines.append("PER-CATEGORY DETAIL (sorted by logic block demand)")
    lines.append("=" * 80)
    for c in sorted(categories, key=lambda x: -x["logic_block_count"]):
        seg_count = len(c["segments"])
        status = "OK" if seg_count > 0 else "EMPTY"
        lines.append(f"[{status:>5}] {c['id']:3d}. {c['name']} — demand:{c['logic_block_count']} supply:{seg_count}")

    # Empty categories (demand but no supply)
    empty_with_demand = [c for c in categories if not c["segments"] and c["logic_block_count"] > 0]
    if empty_with_demand:
        lines.append("")
        lines.append("=" * 80)
        lines.append("GAPS: Categories with demand but NO segments (need new assets)")
        lines.append("=" * 80)
        for c in sorted(empty_with_demand, key=lambda x: -x["logic_block_count"]):
            lines.append(f"  {c['id']:3d}. {c['name']} — {c['logic_block_count']} blocks need this")

    stats_text = "\n".join(lines)
    with open(STATS_PATH, "w", encoding="utf-8") as f:
        f.write(stats_text)

    print(stats_text)
    print(f"\nOutput: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
