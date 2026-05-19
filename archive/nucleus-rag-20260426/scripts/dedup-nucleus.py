# -*- coding: utf-8 -*-
"""Deduplicate Nucleus videos across folders and prepare for ASR.

Scans all mp4 files, deduplicates by filename + filesize,
outputs a list of unique videos to process.
"""

import os
import json
from pathlib import Path
from collections import defaultdict

NUCLEUS_ROOT = Path("P:/团队空间/公司通用/AIkaifa/nucleus")
FOLDERS = ["cardiology", "cardiovascular", "Diseases And Conditions"]
OUTPUT_PATH = Path("f:/AI total editing/editing V1/scripts/nucleus_dedup.json")


def main():
    # Collect all mp4 files
    all_files = []
    for folder in FOLDERS:
        folder_path = NUCLEUS_ROOT / folder
        if not folder_path.exists():
            print(f"SKIP: {folder_path} not found")
            continue
        print(f"Scanning {folder}...")
        for f in folder_path.iterdir():
            if f.suffix.lower() == ".mp4":
                try:
                    size = f.stat().st_size
                    all_files.append({
                        "filename": f.name,
                        "size": size,
                        "path": str(f),
                        "folder": folder,
                    })
                except Exception as e:
                    print(f"  Error reading {f.name}: {e}")

    print(f"\nTotal mp4 files: {len(all_files)}")

    # Dedup by filename (ignoring folder)
    by_name = defaultdict(list)
    for f in all_files:
        by_name[f["filename"]].append(f)

    unique = []
    duplicates = []
    for name, copies in by_name.items():
        # Keep the first one (prefer cardiology since it's already indexed)
        priority = {"cardiology": 0, "cardiovascular": 1, "Diseases And Conditions": 2}
        copies.sort(key=lambda x: priority.get(x["folder"], 99))
        unique.append(copies[0])
        if len(copies) > 1:
            duplicates.append({
                "filename": name,
                "copies": len(copies),
                "folders": [c["folder"] for c in copies],
            })

    print(f"Unique videos: {len(unique)}")
    print(f"Duplicate filenames: {len(duplicates)}")

    # Stats per folder
    from collections import Counter
    folder_counts = Counter(f["folder"] for f in unique)
    for folder, count in folder_counts.most_common():
        print(f"  {folder}: {count}")

    # How many are already in cardiology asset_index?
    existing_index = NUCLEUS_ROOT / "cardiology" / "asset_index.json"
    already_indexed = set()
    if existing_index.exists():
        idx = json.loads(existing_index.read_text(encoding="utf-8"))
        for a in idx.get("assets", []):
            already_indexed.add(a["file"])

    new_videos = [f for f in unique if f["filename"] not in already_indexed]
    print(f"\nAlready indexed (cardiology): {len(already_indexed)}")
    print(f"New videos to process: {len(new_videos)}")

    # Save
    output = {
        "total_scanned": len(all_files),
        "unique": len(unique),
        "duplicates_count": len(duplicates),
        "already_indexed": len(already_indexed),
        "new_to_process": len(new_videos),
        "unique_videos": unique,
        "new_videos": new_videos,
        "duplicates": duplicates,
    }
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\nOutput: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
