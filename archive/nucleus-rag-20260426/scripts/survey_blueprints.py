# -*- coding: utf-8 -*-
import json, os, sys, io, glob
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

paths = (
    glob.glob('P:/团队空间/公司通用/AIkaifa/AI total editing/260407/*/*/out/blueprint_merged.json') +
    glob.glob('P:/团队空间/公司通用/AIkaifa/AI total editing/260407/*/*/*/out/blueprint_merged.json')
)
for p in paths:
    try:
        d = json.load(open(p, 'r', encoding='utf-8'))
        title = d.get('title') or 'NO_TITLE'
        scenes = d.get('scenes', [])
        n_segs = sum(len(s.get('logic_segments', [])) for s in scenes)
        scene_titles = [s.get('title', '')[:25] for s in scenes]
        vid = p.replace('blueprint_merged.json', 'source_direct_cut_video.mp4')
        vid_ok = 'OK ' if os.path.exists(vid) else 'NO '
        norm = p.replace('\\', '/')
        bp = norm.split('260407/')[1].split('/out/')[0]
        print(f'{vid_ok} [{bp}]  <{title}>  scenes={len(scenes)} segs={n_segs}')
        print(f'    {" | ".join(scene_titles)}')
    except Exception as e:
        print(f'ERR {p}: {e}')
