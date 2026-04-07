# -*- coding: utf-8 -*-
"""Extract all logic blocks with atoms text (original narration) from blueprints."""
import json
import os
import glob

root = "P:/团队空间/公司通用/AIkaifa/AI total editing/"
blueprints = glob.glob(os.path.join(root, "**", "blueprint.json"), recursive=True)

all_blocks = []
for bp_path in blueprints:
    try:
        with open(bp_path, 'r', encoding='utf-8') as f:
            bp = json.load(f)
    except:
        continue

    bp_title = bp.get('title', '')
    for scene in bp.get('scenes', []):
        scene_title = scene.get('title', '')
        for seg in scene.get('logic_segments', []):
            seg_id = seg.get('id', '')
            template = seg.get('template', '')
            transition = seg.get('transition_type', '')
            items_text = [item.get('text', '') for item in seg.get('items', [])]

            # Extract atoms original text
            keep_atoms = [a for a in seg.get('atoms', []) if a.get('status') == 'keep']
            atoms_text = ' '.join(a['text'] for a in keep_atoms)

            all_blocks.append({
                'bp_title': bp_title,
                'scene_title': scene_title,
                'seg_id': seg_id,
                'template': template,
                'transition_type': transition,
                'items': items_text,
                'atoms_text': atoms_text,
            })

output_path = "f:/AI total editing/editing V1/scripts/all_logic_blocks_atoms.json"
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(all_blocks, f, ensure_ascii=False, indent=2)

# Stats
has_atoms = sum(1 for b in all_blocks if b['atoms_text'])
print(f"Total blueprints: {len(blueprints)}")
print(f"Total logic blocks: {len(all_blocks)}")
print(f"Blocks with atoms text: {has_atoms}")
print(f"Blocks without atoms: {len(all_blocks) - has_atoms}")
print(f"Saved to {output_path}")
