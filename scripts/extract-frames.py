# -*- coding: utf-8 -*-
"""Extract key frames from all videos in an asset directory for labeling."""
import subprocess, os, json, sys

asset_dir = sys.argv[1]
out_dir = os.path.join(os.environ.get("TEMP", "/tmp"), "asset_label")

videos = []
for root, dirs, files in os.walk(asset_dir):
    for f in sorted(files):
        if f.lower().endswith((".mp4", ".mov")):
            full = os.path.join(root, f)
            rel = os.path.relpath(full, asset_dir).replace(os.sep, "/")
            videos.append((full, rel))

print(f"{len(videos)} videos found")

for i, (full, rel) in enumerate(videos):
    name = os.path.splitext(os.path.basename(full))[0]
    frame_dir = os.path.join(out_dir, f"{i:02d}_{name}")
    if os.path.exists(frame_dir) and len([x for x in os.listdir(frame_dir) if x.endswith(".jpg")]) >= 3:
        print(f"  [{i+1}] {rel} (cached)")
        continue
    os.makedirs(frame_dir, exist_ok=True)
    r = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", full],
        capture_output=True, text=True,
    )
    dur = float(r.stdout.strip()) if r.stdout.strip() else 0
    if dur > 0:
        timestamps = [dur * 0.1, dur * 0.35, dur * 0.65, dur * 0.9]
        for j, ts in enumerate(timestamps):
            out_f = os.path.join(frame_dir, f"f{j:02d}.jpg")
            subprocess.run(
                ["ffmpeg", "-y", "-ss", str(ts), "-i", full, "-frames:v", "1", "-q:v", "3", out_f],
                capture_output=True,
            )
    meta = {"index": i, "rel_path": rel, "duration": round(dur, 1), "name": name}
    with open(os.path.join(frame_dir, "meta.json"), "w", encoding="utf-8") as mf:
        json.dump(meta, mf, ensure_ascii=False)
    print(f"  [{i+1}] {rel} ({dur:.1f}s)")

print("Done")
