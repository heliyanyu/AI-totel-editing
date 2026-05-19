# -*- coding: utf-8 -*-
"""Generate a Jianying review draft from the rendered VU template videos.

This is a lightweight review draft: it concatenates the already-rendered
Remotion VU demo MP4s in order, so the user can inspect all template families
inside Jianying rather than as loose files.

Usage:
  python scripts/generate-vu-review-draft.py
  python scripts/generate-vu-review-draft.py --target <drafts_dir> --draft-name <name>
"""

import argparse
from pathlib import Path

from pyJianYingDraft import (
    ClipSettings,
    DraftFolder,
    SEC,
    TextSegment,
    TextStyle,
    Timerange,
    TrackType,
    VideoMaterial,
    VideoSegment,
)


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_VIDEO_DIR = ROOT / "local_artifacts" / "review_videos_mianyili_03_final"
DEFAULT_TARGET = ROOT / "local_artifacts" / "jianying_demo"
DEFAULT_DRAFT_NAME = "mianyili_03_vu_template_review_draft"


def pos(x_center_px: int = 540, y_center_px: int = 960, scale: float = 1.0) -> ClipSettings:
    return ClipSettings(
        transform_x=(x_center_px - 540) / 540,
        transform_y=(y_center_px - 960) / 960,
        scale_x=scale,
        scale_y=scale,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video-dir", default=str(DEFAULT_VIDEO_DIR))
    parser.add_argument("--target", default=str(DEFAULT_TARGET))
    parser.add_argument("--draft-name", default=DEFAULT_DRAFT_NAME)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    video_dir = Path(args.video_dir).resolve()
    target = Path(args.target).resolve()
    videos = sorted(video_dir.glob("*.mp4"))
    if not videos:
        raise SystemExit(f"No mp4 files found in {video_dir}")

    target.mkdir(parents=True, exist_ok=True)
    folder = DraftFolder(str(target))
    script = folder.create_draft(args.draft_name, 1080, 1920, 30, allow_replace=True)

    script.add_track(TrackType.video, "VU_review_main")
    script.add_track(TrackType.text, "VU_labels", relative_index=1)

    cursor = 0
    total = 0
    for index, video in enumerate(videos, 1):
        material = VideoMaterial(str(video))
        duration = material.duration
        if duration <= 0:
            continue

        script.add_segment(
            VideoSegment(
                material,
                target_timerange=Timerange(cursor, duration),
            ),
            "VU_review_main",
        )

        label = video.stem.replace("_", " ")
        script.add_segment(
            TextSegment(
                f"{index:02d}/{len(videos):02d}  {label}",
                timerange=Timerange(cursor, min(duration, int(2.2 * SEC))),
                style=TextStyle(size=6.5, bold=True, color=(1, 1, 1), align=1),
                clip_settings=pos(540, 74, scale=1.0),
            ),
            "VU_labels",
        )

        cursor += duration
        total += 1

    script.save()
    print(f"Created Jianying review draft with {total} videos")
    print(f"  -> {target / args.draft_name}")


if __name__ == "__main__":
    main()
