"""Extract all logic blocks from blueprints for clustering analysis."""
import json, os, glob
from collections import Counter

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

            all_blocks.append({
                'bp_title': bp_title,
                'scene_title': scene_title,
                'seg_id': seg_id,
                'template': template,
                'transition_type': transition,
                'items': items_text
            })

print(f"Total blueprints: {len(blueprints)}")
print(f"Total logic blocks: {len(all_blocks)}")

# Count templates
templates = Counter(b['template'] for b in all_blocks)
print(f"\nTemplate distribution:")
for t, c in templates.most_common():
    print(f"  {t}: {c}")

# Show some examples
print(f"\n--- Sample blocks ---")
for b in all_blocks[:20]:
    print(f"[{b['bp_title']}] Scene: {b['scene_title']} | Template: {b['template']} | Items: {b['items']}")

# Save full extract for clustering
output_path = "f:/AI total editing/editing V1/scripts/all_logic_blocks.json"
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(all_blocks, f, ensure_ascii=False, indent=2)
print(f"\nSaved to {output_path}")
