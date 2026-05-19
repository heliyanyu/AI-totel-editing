# -*- coding: utf-8 -*-
"""
精选素材 + 生成剪映草稿
"""
import json, sys, subprocess, os, shutil, uuid, time
sys.stdout.reconfigure(encoding='utf-8')

ASSET_ROOT = r'P:\团队空间\公司通用\AIkaifa\nucleus\cardiology'
VIDEO_PATH = r'P:\团队空间\公司通用\AIkaifa\AI total editing\260323\zhanglili kp01\心脏血管狭窄要放支架吗？.mp4'
DRAFT_ROOT = r'C:\Users\heliy\AppData\Local\JianyingPro\User Data\Projects\com.lveditor.draft'

# ---- Step 1: Fine-grained matching with Claude ----

# The 3 segments needing animation
seg_matches = [
    {
        'id': 'S2-L2',
        'start': 59.68, 'end': 82.16,
        'text': '心脏支架呢是属于微创手术它是通过穿刺手腕或者大腿根部的这个动脉血管然后从穿刺的这个地方呢到心脏的血管开口通过导管呢在血管内建立一个通道通过导管呢将支架送到心脏血管的狭窄处最后呢支架扩张撑开血管恢复血流',
        'cat_id': 7,
    },
    {
        'id': 'S2-L3',
        'start': 82.80, 'end': 111.36,
        'text': '心脏搭桥术呢是属于开胸的外科手术简单来说就是心脏血管狭窄或者闭塞了我从别的地方另取一段血管像乳内动脉和大隐静脉然后呢绕开这个心脏血管堵塞这个地方呢给它搭一个桥原来堵塞的地方呢我们不去动它这个桥呀一端连着主动脉另一端呢连在心脏血管狭窄或者闭塞的远端让血液直接绕过那个堵塞的地方',
        'cat_id': 10,
    },
    {
        'id': 'S3-L16',
        'start': 257.36, 'end': 263.12,
        'text': '但桥血管也有可能随着时间的变化发生动脉硬化甚至堵塞尤其是静脉桥啊很容易堵塞',
        'cat_id': 3,
    },
]

# Load classified assets
with open(r'F:/AI total editing/editing V1/scripts/asset_blocks_classified.json', 'r', encoding='utf-8') as f:
    all_assets = json.load(f)

def get_cat_assets(cat_id):
    result = []
    for a in all_assets:
        raw = a['category_raw'].strip()
        try:
            num = int(raw.split('（')[0].split('(')[0].strip())
            if num == cat_id:
                result.append(a)
        except:
            pass
    return result

# Use FULL videos, speed up to fit segment duration
final_matches = [
    {
        'seg_id': 'S2-L2',
        'seg_start': 59.68, 'seg_end': 82.16,
        'asset_file': 'ANCE00174_Coronary Artery Angioplasty (Radial Access).mp4',
        'asset_duration': 176.7,  # full video
    },
    {
        'seg_id': 'S2-L3',
        'seg_start': 82.80, 'seg_end': 111.36,
        'asset_file': 'ANCE00199_Coronary Artery Bypass Graft (CABG).mp4',
        'asset_duration': 264.5,  # full video
    },
    {
        'seg_id': 'S3-L16',
        'seg_start': 257.36, 'seg_end': 263.12,
        'asset_file': 'ANS00170_Atherosclerosis.mp4',
        'asset_duration': 25.0,  # short version, 5.8s segment
    },
]

for m in final_matches:
    seg_dur = m['seg_end'] - m['seg_start']
    speed = m['asset_duration'] / seg_dur
    print(f"  {m['seg_id']}: {m['asset_file'][:50]} ({m['asset_duration']:.0f}s → {seg_dur:.1f}s, {speed:.1f}x)")

# ---- Step 2: Generate JianYing Draft ----
print(f"\n{'='*60}")
print("Generating JianYing draft...")

sys.path.insert(0, r'F:\miniconda3\envs\agent\Lib\site-packages')
from pyJianYingDraft import (
    DraftFolder,
    TrackType,
    Timerange,
    VideoSegment,
    SEC,
)

draft_name = "支架vs搭桥_素材匹配测试"
main_end = 280.0  # approximate total duration
total_us = int(main_end * SEC)

folder = DraftFolder(DRAFT_ROOT)
script = folder.create_draft(draft_name, 1080, 1920, 30, allow_replace=True)

# Track 1: main video
script.add_track(TrackType.video, "main")
script.add_segment(VideoSegment(
    VIDEO_PATH,
    target_timerange=Timerange(0, total_us),
), "main")
print(f"  + main video: {VIDEO_PATH}")

# Track 2: asset overlay
script.add_track(TrackType.video, "assets", relative_index=1)

for match in final_matches:
    asset_file = os.path.join(ASSET_ROOT, match['asset_file'])

    if not os.path.exists(asset_file):
        print(f"  WARNING: asset file not found: {asset_file}")
        continue

    seg_duration = match['seg_end'] - match['seg_start']
    asset_dur = match['asset_duration']

    target_start_us = int(match['seg_start'] * SEC)
    target_dur_us = int(seg_duration * SEC)
    # source_dur = full asset, but trim 200ms safety margin to stay within file
    source_dur_us = int(asset_dur * SEC) - 200000

    try:
        script.add_segment(VideoSegment(
            asset_file,
            target_timerange=Timerange(target_start_us, target_dur_us),
            source_timerange=Timerange(0, source_dur_us),
        ), "assets")
        speed = asset_dur / seg_duration
        print(f"  + {match['seg_id']}: {match['asset_file'][:45]} (full {asset_dur:.0f}s → {seg_duration:.1f}s, {speed:.1f}x)")
    except ValueError as e:
        print(f"  WARN {match['seg_id']}: {e}")

script.save()
print(f"\nDraft saved to: {DRAFT_ROOT}\\{draft_name}")
print("Done! Open JianYing to see the result.")
