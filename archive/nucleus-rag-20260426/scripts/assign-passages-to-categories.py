# -*- coding: utf-8 -*-
"""
把素材的1128个logic blocks的英文原文归入115个分类。
原文不动，只标分类编号。
"""
import json, sys, subprocess, os
sys.stdout.reconfigure(encoding='utf-8')

# Load categories
with open(r'F:/AI total editing/editing V1/scripts/confusion_taxonomy_v2.json', 'r', encoding='utf-8') as f:
    taxonomy = json.load(f)
cat_names = list(taxonomy.keys())
cat_list = "\n".join([f"{i+1}. {c}" for i, c in enumerate(cat_names)])

# Load asset logic blocks
with open(r'F:/AI total editing/editing V1/scripts/cluster_atoms/asset_logic_blocks_all.json', 'r', encoding='utf-8') as f:
    blocks = json.load(f)

print(f"Total asset blocks: {len(blocks)}")
print(f"Categories: {len(cat_names)}")

# Process in batches of 30
batch_size = 30
results_path = r'F:/AI total editing/editing V1/scripts/asset_blocks_classified.json'

# Resume from previous progress
results = []
done_count = 0
if os.path.exists(results_path):
    with open(results_path, 'r', encoding='utf-8') as f:
        results = json.load(f)
    done_count = len(results)
    print(f"Resuming from {done_count} already classified")

for bi in range(done_count, len(blocks), batch_size):
    batch = blocks[bi:bi+batch_size]
    batch_num = bi // batch_size + 1
    total_batches = (len(blocks) + batch_size - 1) // batch_size
    print(f"\n--- Batch {batch_num}/{total_batches} (blocks {bi+1}-{bi+len(batch)}) ---")

    block_list = "\n".join([
        f"{i+1}. [{b['file'][:30]}] {b['text_en'][:150]}"
        for i, b in enumerate(batch)
    ])

    prompt = f"""以下是医学动画素材的英文旁白片段。请为每个片段标注它属于哪个分类编号。

规则：
- 只看这段原文讲的内容属于哪个分类，直接归类，不要提炼概括
- 每个片段标1个最匹配的分类编号
- 如果没有合适的分类，写"0:画面描述"

分类列表（共{len(cat_names)}个）：
{cat_list}

素材片段：
{block_list}

输出格式（每行一个）：
编号 → 分类编号"""

    prompt_file = r'F:/AI total editing/editing V1/scripts/classify_asset_prompt.txt'
    with open(prompt_file, 'w', encoding='utf-8') as f:
        f.write(prompt)

    try:
        result = subprocess.run(
            f'cat "{prompt_file}" | claude -p --output-format text',
            capture_output=True, text=True, encoding='utf-8', timeout=120,
            shell=True
        )
        output = result.stdout.strip()
        print(output)

        # Parse results
        for line in output.strip().split('\n'):
            line = line.strip()
            if not line or '→' not in line:
                continue
            parts = line.split('→')
            idx_str = parts[0].strip()
            cat_str = parts[1].strip()

            try:
                idx = int(idx_str) - 1
            except:
                continue

            if 0 <= idx < len(batch):
                block = batch[idx]
                results.append({
                    'file': block['file'],
                    'title': block['title'],
                    'start': block['start'],
                    'end': block['end'],
                    'text_en': block['text_en'][:300],
                    'category_raw': cat_str
                })

        # Save progress after each batch
        with open(results_path, 'w', encoding='utf-8') as f:
            json.dump(results, f, ensure_ascii=False, indent=2)

    except subprocess.TimeoutExpired:
        print("  TIMEOUT, saving progress")
        with open(results_path, 'w', encoding='utf-8') as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"  ERROR: {e}")

# Summary
print(f"\n{'='*60}")
print(f"Classified {len(results)} / {len(blocks)} blocks")

# Count per category
cat_counts = {}
no_match = []
for r in results:
    raw = r['category_raw'].strip()
    if raw.startswith('0'):
        no_match.append(r)
    else:
        try:
            cat_id = int(raw.split('（')[0].split('(')[0].strip()) - 1
            if 0 <= cat_id < len(cat_names):
                name = cat_names[cat_id]
                cat_counts[name] = cat_counts.get(name, 0) + 1
        except:
            pass

print(f"\n=== 素材分类分布 (top 30) ===")
for name, count in sorted(cat_counts.items(), key=lambda x: -x[1])[:30]:
    print(f"  [{count:3d}] {name}")

print(f"\n=== 空分类（没有素材匹配到的）===")
for i, name in enumerate(cat_names):
    if name not in cat_counts and name != '无需动画':
        print(f"  {i+1}. {name}")

if no_match:
    print(f"\n=== 无匹配: {len(no_match)}个 ===")
    for r in no_match[:20]:
        print(f"  [{r['file'][:30]}] {r['category_raw']}")

print("\nDone!")
