# -*- coding: utf-8 -*-
"""
用100个真实logic blocks验证115个分类的覆盖度。
"""
import json, sys, subprocess
sys.stdout.reconfigure(encoding='utf-8')

with open(r'F:/AI total editing/editing V1/scripts/confusion_taxonomy_v2.json', 'r', encoding='utf-8') as f:
    taxonomy = json.load(f)
cat_names = list(taxonomy.keys())
cat_list = "\n".join([f"{i+1}. {c}" for i, c in enumerate(cat_names)])

with open(r'F:/AI total editing/editing V1/scripts/sampled_logic_blocks.json', 'r', encoding='utf-8') as f:
    blocks = json.load(f)

print(f"Validating {len(blocks)} logic blocks against {len(cat_names)} categories\n")

# Process in batches of 25
batch_size = 25
all_results = []

for bi in range(0, len(blocks), batch_size):
    batch = blocks[bi:bi+batch_size]
    print(f"--- Batch {bi//batch_size + 1} ({len(batch)} blocks) ---")

    block_list = "\n".join([
        f"{i+1}. [{b['blueprint'][:25]}] {b['atoms'][:100]}"
        for i, b in enumerate(batch)
    ])

    prompt = f"""以下是医学科普视频蓝图中的logic blocks（医生的口播原文片段）。
请为每个block标注它最需要的医学动画分类编号。如果115个分类中没有合适的，写"无匹配:需要的画面描述"。

分类列表（共{len(cat_names)}个）：
{cat_list}

logic blocks：
{block_list}

输出格式（每行一个block）：
编号 → 分类编号 或 "无需动画" 或 "无匹配:画面描述"
"""

    prompt_file = r'F:/AI total editing/editing V1/scripts/validate_block_prompt.txt'
    with open(prompt_file, 'w', encoding='utf-8') as f:
        f.write(prompt)

    try:
        result = subprocess.run(
            f'cat "{prompt_file}" | claude -p --output-format text',
            capture_output=True, text=True, encoding='utf-8', timeout=120,
            shell=True
        )
        output = result.stdout.strip()
        all_results.append(output)
        print(output)
        print()
    except subprocess.TimeoutExpired:
        print("  TIMEOUT")
    except Exception as e:
        print(f"  ERROR: {e}")

# Count "无匹配" occurrences
all_text = "\n".join(all_results)
no_match_lines = [l for l in all_text.split('\n') if '无匹配' in l]
print(f"\n{'='*60}")
print(f"=== 验证结果 ===")
print(f"总blocks: {len(blocks)}")
print(f"无匹配的blocks: {len(no_match_lines)}")
if no_match_lines:
    print(f"\n缺失的分类（115个覆盖不到的）：")
    for line in no_match_lines:
        print(f"  {line}")

print("\nDone!")
