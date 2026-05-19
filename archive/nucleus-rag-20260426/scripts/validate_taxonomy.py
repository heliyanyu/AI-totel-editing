# -*- coding: utf-8 -*-
"""
验证分类体系：拿几篇实际文案，看每个段落匹配到哪些分类。
"""
import re, json, sys, subprocess
sys.stdout.reconfigure(encoding='utf-8')

# Load taxonomy category names
with open(r'F:/AI total editing/editing V1/scripts/confusion_taxonomy_v2.json', 'r', encoding='utf-8') as f:
    taxonomy = json.load(f)
cat_names = list(taxonomy.keys())
cat_list = "\n".join([f"{i+1}. {c}" for i, c in enumerate(cat_names)])

# Load articles
with open(r'F:/wenan qwen/data/heliyanyu KP03.md', 'r', encoding='utf-8') as f:
    content = f.read()
articles = re.split(r'^### \d+\. ', content, flags=re.MULTILINE)[1:]

# Pick diverse articles
picks = [5, 15, 23, 3, 49]

for idx in picks:
    art = articles[idx]
    lines = art.strip().split('\n')
    title = lines[0].strip().replace('.docx', '').replace('.doc', '')

    in_block = False
    text_lines = []
    for line in lines:
        if line.strip().startswith('```text'):
            in_block = True
            continue
        if line.strip().startswith('```') and in_block:
            break
        if in_block:
            text_lines.append(line.strip())

    body = '\n'.join([l for l in text_lines if l and not l.startswith('封面') and not l.startswith('标题')])

    print(f"\n{'='*60}")
    print(f"文案: {title}")
    print(f"{'='*60}")

    # Write prompt to temp file
    prompt_text = f"""以下是一篇医学科普文案的全文。请把它按段落/话题拆分，然后为每个段落标注它最需要的医学动画分类编号。

分类列表（共{len(cat_names)}个）：
{cat_list}

要求：
1. 把文案拆成5-10个段落（按话题自然断开）
2. 每个段落标注1-3个最匹配的分类编号
3. 如果某段落不需要动画，标注"无需动画"
4. 输出格式：每段一行，格式为"段落摘要(20字以内) → 分类编号, 分类编号"
5. 不要输出JSON，只要简洁的文本

文案全文：
{body[:2000]}"""

    prompt_file = r'F:/AI total editing/editing V1/scripts/validate_prompt_temp.txt'
    with open(prompt_file, 'w', encoding='utf-8') as f:
        f.write(prompt_text)

    try:
        result = subprocess.run(
            f'cat "{prompt_file}" | claude -p --output-format text',
            capture_output=True, text=True, encoding='utf-8', timeout=120,
            shell=True
        )
        output = result.stdout.strip()
        print(output)
        print()

        # Also print the category names for reference
        # Extract mentioned category numbers
        nums = set(re.findall(r'(\d+)', output))
        if nums:
            print("涉及的分类：")
            for n in sorted(nums, key=int):
                ni = int(n) - 1
                if 0 <= ni < len(cat_names):
                    print(f"  {n}. {cat_names[ni]}")
    except subprocess.TimeoutExpired:
        print("  TIMEOUT")
    except Exception as e:
        print(f"  ERROR: {e}")

print("\nDone!")
