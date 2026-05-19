# -*- coding: utf-8 -*-
"""Compose an asset overlay track with proper video clips."""

import subprocess
import sys
import os

MATCHES = [
    (65.10, 68.14,
     "F:/AI total editing/editing V1/2 循环系统疾病/10 主动脉和周围血管疾病/冠状动脉疾病.mp4",
     0, 3.04),
    (68.46, 71.42,
     "F:/AI total editing/editing V1/2 循环系统疾病/10 主动脉和周围血管疾病/血栓形成.mp4",
     8, 10.96),
    (71.50, 76.70,
     "F:/AI total editing/editing V1/2 循环系统疾病/5 心肌疾病/心肌梗塞.mp4",
     5, 10.2),
    (77.02, 85.02,
     "F:/AI total editing/editing V1/2 循环系统疾病/1 心力衰竭/心肌梗死-1.mp4",
     19, 27),
    (97.60, 101.12,
     "F:/AI total editing/editing V1/2 循环系统疾病/1 心力衰竭/心脏造影-1.mp4",
     15, 18.52),
    (101.36, 105.20,
     "F:/AI total editing/editing V1/2 循环系统疾病/3 动脉粥样硬化和冠状动脉粥样硬化性心脏病/球囊以及支架-1.mp4",
     10, 13.84),
]

TOTAL_DURATION = 307.84
WIDTH = 1080
HEIGHT = 1920
ASSET_W = 900
ASSET_H = 506
ASSET_X = (WIDTH - ASSET_W) // 2
ASSET_Y = 220

OUT_DIR = sys.argv[1] if len(sys.argv) > 1 else "P:/团队空间/公司通用/AIkaifa/AI total editing/260324/zhouqi/mengxiangen/02/out"
output_path = os.path.join(OUT_DIR, "asset_overlay.mp4")

# Build a single ffmpeg command with all inputs and complex filter
# Input 0: black base
inputs = [
    "-f", "lavfi", "-i",
    f"color=c=black:s={WIDTH}x{HEIGHT}:d={TOTAL_DURATION}:r=30",
]

# Inputs 1-6: each asset clip (use -ss AFTER -i for accurate frame seeking)
for i, (out_start, out_end, asset_file, asset_ss, _) in enumerate(MATCHES):
    clip_dur = out_end - out_start
    inputs += ["-i", asset_file]

# Build complex filter
filter_parts = []
prev = "[0:v]"

for i, (out_start, out_end, _, asset_ss, _) in enumerate(MATCHES):
    clip_dur = out_end - out_start
    inp_idx = i + 1

    # Trim the input, scale it, set fps to 30
    scaled = f"[s{i}]"
    filter_parts.append(
        f"[{inp_idx}:v]trim=start={asset_ss}:duration={clip_dur},setpts=PTS-STARTPTS,"
        f"fps=30,"
        f"scale={ASSET_W}:{ASSET_H}:force_original_aspect_ratio=decrease,"
        f"pad={ASSET_W}:{ASSET_H}:(ow-iw)/2:(oh-ih)/2:color=black"
        f"{scaled}"
    )

    ov = f"[v{i}]"
    filter_parts.append(
        f"{prev}{scaled}overlay=x={ASSET_X}:y={ASSET_Y}:"
        f"enable='between(t,{out_start},{out_end})'"
        f"{ov}"
    )
    prev = ov

filter_str = ";".join(filter_parts)

cmd = [
    "ffmpeg", "-y",
] + inputs + [
    "-filter_complex", filter_str,
    "-map", prev,
    "-c:v", "h264_nvenc", "-preset", "p4", "-cq", "18",
    "-pix_fmt", "yuv420p",
    "-an",
    output_path,
]

print(f"Composing asset overlay ({len(MATCHES)} clips) ...")
result = subprocess.run(cmd, capture_output=True)
if result.returncode != 0:
    stderr = result.stderr.decode("utf-8", errors="replace")
    print("FAILED:", stderr[-3000:])
    sys.exit(1)

size_mb = os.path.getsize(output_path) / 1024 / 1024
print(f"Done: {output_path} ({size_mb:.1f} MB)")
