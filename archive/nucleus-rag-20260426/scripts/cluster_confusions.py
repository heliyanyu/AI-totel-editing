# -*- coding: utf-8 -*-
"""
将800个unique confusions分批聚类，然后合并成最终分类体系。
"""
import json, sys, subprocess
sys.stdout.reconfigure(encoding='utf-8')

with open(r'F:/AI total editing/editing V1/scripts/unique_confusions.txt', 'r', encoding='utf-8') as f:
    confusions = [line.strip() for line in f if line.strip()]

print(f"Total unique confusions: {len(confusions)}")

# Step 1: Split into batches of 200, each batch independently clustered
batch_size = 200
batches = [confusions[i:i+batch_size] for i in range(0, len(confusions), batch_size)]
print(f"Batches: {len(batches)}")

all_categories = {}

for bi, batch in enumerate(batches):
    print(f"\n--- Batch {bi+1}/{len(batches)} ({len(batch)} confusions) ---")
    confusion_list = "\n".join([f"- {c}" for c in batch])

    prompt = f"""以下是从医学科普文案中提取的"观众困惑"列表。请将它们归纳成分类。

要求：
1. 分类反映"需要什么样的医学动画画面"
2. 每个分类至少包含3个困惑
3. 分类数量控制在10-20个
4. "非科普"内容归为一类
5. 只输出JSON对象，key是分类名，value是困惑列表

困惑列表：
{confusion_list}"""

    try:
        result = subprocess.run(
            ['claude', '-p', prompt, '--output-format', 'text'],
            capture_output=True, text=True, encoding='utf-8', timeout=300
        )
        text = result.stdout.strip()
        start = text.find('{')
        end = text.rfind('}') + 1
        if start >= 0 and end > start:
            batch_cats = json.loads(text[start:end])
            for cat, items in batch_cats.items():
                if cat in all_categories:
                    all_categories[cat].extend(items)
                else:
                    all_categories[cat] = items
            print(f"  Got {len(batch_cats)} categories")
        else:
            print(f"  WARNING: no JSON found")
    except subprocess.TimeoutExpired:
        print(f"  TIMEOUT")
    except json.JSONDecodeError as e:
        print(f"  JSON error: {e}")

# Save intermediate
with open(r'F:/AI total editing/editing V1/scripts/confusion_categories_raw.json', 'w', encoding='utf-8') as f:
    json.dump(all_categories, f, ensure_ascii=False, indent=2)

print(f"\n=== Raw categories: {len(all_categories)} ===")
for cat, items in all_categories.items():
    print(f"  【{cat}】{len(items)}个")

# Step 2: Merge similar categories
cat_summary = "\n".join([f"- {cat} ({len(items)}个): {', '.join(items[:5])}..." for cat, items in all_categories.items()])

print("\n--- Merging similar categories ---")
merge_prompt = f"""以下是从多批数据中独立生成的分类。有些分类名称不同但含义相近，请合并它们。

要求：
1. 最终分类数量控制在15-25个
2. 合并含义相近的分类，保留最清晰的名称
3. 只输出JSON对象：key是最终分类名，value是它合并了哪些原始分类名（数组）
4. 不要遗漏任何原始分类

原始分类列表：
{cat_summary}"""

try:
    result2 = subprocess.run(
        ['claude', '-p', merge_prompt, '--output-format', 'text'],
        capture_output=True, text=True, encoding='utf-8', timeout=300
    )
    text2 = result2.stdout.strip()
    start2 = text2.find('{')
    end2 = text2.rfind('}') + 1
    if start2 >= 0 and end2 > start2:
        merge_map = json.loads(text2[start2:end2])

        # Build final taxonomy
        final_taxonomy = {}
        for final_cat, source_cats in merge_map.items():
            final_taxonomy[final_cat] = []
            for src in source_cats:
                if src in all_categories:
                    final_taxonomy[final_cat].extend(all_categories[src])

        with open(r'F:/AI total editing/editing V1/scripts/confusion_taxonomy.json', 'w', encoding='utf-8') as f:
            json.dump(final_taxonomy, f, ensure_ascii=False, indent=2)

        print(f"\n=== 最终分类体系 ({len(final_taxonomy)}个分类) ===")
        for cat, items in final_taxonomy.items():
            print(f"\n【{cat}】({len(items)}个困惑)")
            for item in items[:5]:
                print(f"  - {item}")
            if len(items) > 5:
                print(f"  ... 共{len(items)}个")
    else:
        print("WARNING: no JSON in merge response")
        print(text2[:1000])
except subprocess.TimeoutExpired:
    print("TIMEOUT on merge step")
except json.JSONDecodeError as e:
    print(f"JSON error on merge: {e}")

print("\nDone!")
