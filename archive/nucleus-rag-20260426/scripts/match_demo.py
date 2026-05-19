# -*- coding: utf-8 -*-
"""
完整匹配演示：蓝图 logic segment → 分类 → 从素材库中找匹配
"""
import json, sys, subprocess
sys.stdout.reconfigure(encoding='utf-8')

# 1. Load taxonomy
with open(r'F:/AI total editing/editing V1/scripts/confusion_taxonomy_v2.json', 'r', encoding='utf-8') as f:
    taxonomy = json.load(f)
cat_names = list(taxonomy.keys())
cat_list = "\n".join([f"{i+1}. {c}" for i, c in enumerate(cat_names)])

# 2. Load classified assets and build index: category_id -> list of asset blocks
with open(r'F:/AI total editing/editing V1/scripts/asset_blocks_classified.json', 'r', encoding='utf-8') as f:
    asset_blocks = json.load(f)

cat_index = {}
for ab in asset_blocks:
    raw = ab['category_raw'].strip()
    try:
        cat_id = int(raw.split('（')[0].split('(')[0].strip())
        if 1 <= cat_id <= len(cat_names):
            cat_index.setdefault(cat_id, []).append(ab)
    except:
        pass

print(f"Asset index: {len(cat_index)} categories with assets")

# 3. Load blueprint
bp_path = r'P:/团队空间/公司通用/AIkaifa/AI total editing/260323/zhanglili kp01/out/blueprint.json'
with open(bp_path, 'r', encoding='utf-8') as f:
    bp = json.load(f)

# Extract all logic segments
segments = []
for scene in bp.get('scenes', []):
    for seg in scene.get('logic_segments', []):
        atoms_text = ''.join([a.get('text', '') for a in seg.get('atoms', [])])
        if atoms_text.strip():
            segments.append({
                'id': seg['id'],
                'scene': scene['title'],
                'atoms': atoms_text
            })

print(f"Blueprint: {bp['title']}")
print(f"Segments: {len(segments)}")

# 4. Classify each segment
seg_list = "\n".join([
    f"{i+1}. {s['atoms'][:120]}"
    for i, s in enumerate(segments)
])

prompt = f"""以下是医生口播的原文片段（来自蓝图"心脏支架 vs 搭桥"）。为每个片段标注最匹配的分类编号。

规则：
- 直接看原文内容归类，不提炼
- 每个片段标1个分类编号
- 不需要动画的标1

分类列表：
{cat_list}

片段：
{seg_list}

输出格式：
编号 → 分类编号"""

prompt_file = r'F:/AI total editing/editing V1/scripts/match_demo_prompt.txt'
with open(prompt_file, 'w', encoding='utf-8') as f:
    f.write(prompt)

result = subprocess.run(
    f'cat "{prompt_file}" | claude -p --output-format text',
    capture_output=True, text=True, encoding='utf-8', timeout=120, shell=True
)

output = result.stdout.strip()
print(f"\n=== 蓝图segment分类 ===")
print(output)

# Parse
seg_cats = {}
for line in output.strip().split('\n'):
    if '→' not in line:
        continue
    parts = line.split('→')
    try:
        idx = int(parts[0].strip()) - 1
        cat_id = int(parts[1].strip().split('（')[0].split('(')[0].strip())
        if 0 <= idx < len(segments):
            seg_cats[idx] = cat_id
    except:
        pass

# 5. For each classified segment, find matching assets
print(f"\n{'='*70}")
print(f"=== 匹配结果 ===")
print(f"{'='*70}")

matched_count = 0
for i, seg in enumerate(segments):
    cat_id = seg_cats.get(i, 0)
    cat_name = cat_names[cat_id - 1] if 1 <= cat_id <= len(cat_names) else "无"
    assets = cat_index.get(cat_id, [])

    print(f"\n{seg['id']} [{cat_name}]")
    print(f"  原文: {seg['atoms'][:80]}...")
    if cat_id == 1:
        print(f"  → 无需动画")
    elif assets:
        matched_count += 1
        print(f"  → 候选素材 {len(assets)} 个:")
        for a in assets[:3]:
            print(f"    [{a['file'][:40]}] {a['start']:.0f}-{a['end']:.0f}s: {a['text_en'][:100]}")
        if len(assets) > 3:
            print(f"    ... 共{len(assets)}个候选")
    else:
        print(f"  → 素材库中无此分类的素材")

no_anim = sum(1 for i in range(len(segments)) if seg_cats.get(i, 0) == 1)
has_assets = sum(1 for i in range(len(segments)) if seg_cats.get(i, 0) != 1 and cat_index.get(seg_cats.get(i, 0), []))
no_assets = sum(1 for i in range(len(segments)) if seg_cats.get(i, 0) != 1 and not cat_index.get(seg_cats.get(i, 0), []))

print(f"\n{'='*70}")
print(f"=== 汇总 ===")
print(f"总segments: {len(segments)}")
print(f"无需动画: {no_anim}")
print(f"有素材可匹配: {has_assets}")
print(f"分类有但素材库无: {no_assets}")
print(f"匹配率: {has_assets}/{len(segments)-no_anim} = {has_assets/(len(segments)-no_anim)*100:.0f}%")
