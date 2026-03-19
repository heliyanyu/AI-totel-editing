"""
Batch rembg processing - called by matting/index.ts

Usage: python batch_rembg.py <input_dir> <output_dir> [model]

Processes all PNG images in input_dir, removes background, saves to output_dir.
Supports resuming: skips files that already exist in output_dir.
"""

import sys
import os
from pathlib import Path

def main():
    if len(sys.argv) < 3:
        print("Usage: python batch_rembg.py <input_dir> <output_dir> [model]")
        sys.exit(1)

    input_dir = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])
    model_name = sys.argv[3] if len(sys.argv) > 3 else "u2net"

    if not input_dir.exists():
        print(f"Error: Input directory not found: {input_dir}")
        sys.exit(1)

    output_dir.mkdir(parents=True, exist_ok=True)

    # Collect PNG files
    png_files = sorted([f for f in input_dir.iterdir() if f.suffix.lower() == ".png"])
    total = len(png_files)

    if total == 0:
        print("Error: No PNG files found in input directory")
        sys.exit(1)

    # Check which files are already processed (for resume support)
    already_done = set()
    for f in output_dir.iterdir():
        if f.suffix.lower() == ".png":
            already_done.add(f.name)

    to_process = [f for f in png_files if f.name not in already_done]
    skip_count = total - len(to_process)

    if skip_count > 0:
        print(f"  Resuming: {skip_count}/{total} already processed, {len(to_process)} remaining")

    if len(to_process) == 0:
        print(f"  All {total} frames already processed!")
        sys.exit(0)

    # Import rembg (lazy to show progress first)
    from rembg import new_session, remove
    from PIL import Image

    print(f"  Loading rembg model: {model_name}")
    session = new_session(model_name)

    processed = skip_count
    for i, png_path in enumerate(to_process):
        out_path = output_dir / png_path.name

        img = Image.open(png_path)
        result = remove(img, session=session, alpha_matting=True)
        result.save(out_path)

        processed += 1
        if (i + 1) % 50 == 0 or (i + 1) == len(to_process):
            pct = processed / total * 100
            print(f"  Progress: {processed}/{total} ({pct:.1f}%)")

    print(f"  rembg done: {processed}/{total} frames processed")

if __name__ == "__main__":
    main()
