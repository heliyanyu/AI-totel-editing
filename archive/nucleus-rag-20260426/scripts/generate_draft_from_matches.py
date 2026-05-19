# -*- coding: utf-8 -*-
"""
Generate JianYing draft from match_result.json + main video.

Layout:
  Track "main": the cut doctor video on the timeline 0..total
  Track "assets": for each picked match, overlay Nucleus mp4 at its time_start..time_end slot,
                  using the matched BLOCK's source range, accelerated/slowed to fit.

Usage:
  python generate_draft_from_matches.py \
      --matches scripts/matches/cbj54.json \
      --main "P:/.../cbj54/out/source_direct_cut_video.mp4" \
      --draft-name "cbj54_素材匹配MVP" \
      --min-cosine 0.55
"""
import argparse, json, os, sys, io, subprocess

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, r'F:/miniconda3/envs/agent/Lib/site-packages')

from pyJianYingDraft import DraftFolder, TrackType, Timerange, VideoSegment, SEC

DRAFT_ROOT = r'C:/Users/heliy/AppData/Local/JianyingPro/User Data/Projects/com.lveditor.draft'


def ffprobe_duration(path):
    out = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
         '-of', 'default=noprint_wrappers=1:nokey=1', path],
        capture_output=True, text=True, timeout=30,
    )
    return float(out.stdout.strip())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--matches', required=True, help='match_result.json from match_blueprint.py')
    ap.add_argument('--main', help='Main doctor video mp4 path (or set MAIN_VIDEO env var to avoid CLI encoding issues with Chinese paths)')
    ap.add_argument('--draft-name', required=True)
    ap.add_argument('--min-cosine', type=float, default=0.0,
                    help='Skip picks where best candidate cosine < this threshold')
    ap.add_argument('--draft-root', default=DRAFT_ROOT)
    ap.add_argument('--width', type=int, default=1080)
    ap.add_argument('--height', type=int, default=1920)
    ap.add_argument('--fps', type=int, default=30)
    args = ap.parse_args()

    main_path = os.environ.get('MAIN_VIDEO') or args.main
    if not main_path:
        sys.exit('Main video not specified (use --main or MAIN_VIDEO env var)')

    with open(args.matches, 'r', encoding='utf-8') as f:
        match_data = json.load(f)
    print(f"Loaded {len(match_data['results'])} match results from {args.matches}")
    print(f"Main video: {main_path}")
    if not os.path.exists(main_path):
        sys.exit(f'Main video not found: {main_path}')

    # Decide picks to use
    picks = []
    skipped = []
    for r in match_data['results']:
        if r['pick'] == 0 or not r.get('picked'):
            skipped.append((r['seg_id'], 'no pick'))
            continue
        p = r['picked']
        if p['cosine'] < args.min_cosine:
            skipped.append((r['seg_id'], f'cosine {p["cosine"]:.2f} < {args.min_cosine}'))
            continue
        if not p.get('mp4_path') or not os.path.exists(p['mp4_path']):
            skipped.append((r['seg_id'], f'mp4 not found: {p.get("mp4_path")}'))
            continue
        if r.get('time_start') is None or r.get('time_end') is None:
            skipped.append((r['seg_id'], 'no timing'))
            continue
        picks.append(r)
    print(f'\nPicks to render: {len(picks)}; skipped: {len(skipped)}')
    for sid, reason in skipped[:20]:
        print(f'  skip {sid}: {reason}')

    # Main video actual duration caps the timeline — blueprint time_end may exceed it.
    # pyJianYingDraft rounds material.duration to 0.1s; back off 0.2s to stay under that rounded value.
    video_dur = ffprobe_duration(main_path) - 0.2
    max_match_end = 0.0
    for r in match_data['results']:
        if r.get('time_end') and r['time_end'] > max_match_end:
            max_match_end = r['time_end']
    main_end = min(max_match_end, video_dur)
    total_us = int(main_end * SEC)
    print(f'\nMain video safe duration: {video_dur:.1f}s; max match end: {max_match_end:.1f}s; using: {main_end:.1f}s')

    folder = DraftFolder(args.draft_root)
    script = folder.create_draft(args.draft_name, args.width, args.height, args.fps, allow_replace=True)

    # Main track
    script.add_track(TrackType.video, 'main')
    script.add_segment(VideoSegment(
        main_path,
        target_timerange=Timerange(0, total_us),
    ), 'main')
    print(f'  + main: {os.path.basename(main_path)} 0..{main_end:.1f}s')

    # Overlay track
    script.add_track(TrackType.video, 'assets', relative_index=1)

    placed = 0
    for r in picks:
        p = r['picked']
        target_start = r['time_start']
        target_end = min(r['time_end'], main_end)
        target_dur = target_end - target_start
        if target_start >= main_end or target_dur <= 0.1:
            print(f"  skip [{r['seg_id']}]: beyond main video duration")
            continue
        # Source: use the matched block's range
        src_start = max(0.0, p['start'] or 0.0)
        src_end = p['end'] or src_start
        src_dur = max(0.1, src_end - src_start)

        target_start_us = int(target_start * SEC)
        target_dur_us = int(target_dur * SEC)
        src_start_us = int(src_start * SEC)
        src_dur_us = int(src_dur * SEC)

        try:
            script.add_segment(VideoSegment(
                p['mp4_path'],
                target_timerange=Timerange(target_start_us, target_dur_us),
                source_timerange=Timerange(src_start_us, src_dur_us),
            ), 'assets')
            speed_x = src_dur / target_dur
            print(f"  + [{r['seg_id']}] {os.path.basename(p['mp4_path'])[:50]}  "
                  f"target {target_start:.1f}-{target_start + target_dur:.1f}s "
                  f"src {src_start:.1f}-{src_end:.1f}s  speed={speed_x:.2f}x")
            placed += 1
        except Exception as e:
            print(f"  ERR [{r['seg_id']}] {e}")

    script.save()
    print(f'\nDone. Placed {placed}/{len(picks)} overlays. Draft: {args.draft_root}/{args.draft_name}')


if __name__ == '__main__':
    main()
