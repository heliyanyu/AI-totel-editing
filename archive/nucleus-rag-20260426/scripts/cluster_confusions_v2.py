# -*- coding: utf-8 -*-
"""
V2: 不预设分类数量，让困惑自然聚类。
策略：先让 Claude 给每个困惑打标签（需要什么画面），然后按画面标签聚类。
"""
import json, sys, subprocess
sys.stdout.reconfigure(encoding='utf-8')

with open(r'F:/AI total editing/editing V1/scripts/unique_confusions.txt', 'r', encoding='utf-8') as f:
    confusions = [line.strip() for line in f if line.strip()]

# Filter out 非科普
confusions = [c for c in confusions if c != '非科普']
print(f"Total confusions (excl 非科普): {len(confusions)}")

# Step 1: For each confusion, tag what kind of visual/animation it needs
batch_size = 150
batches = [confusions[i:i+batch_size] for i in range(0, len(confusions), batch_size)]
print(f"Batches: {len(batches)}")

all_tagged = []

for bi, batch in enumerate(batches):
    print(f"\n--- Batch {bi+1}/{len(batches)} ({len(batch)} confusions) ---")
    confusion_list = "\n".join([f"{i+1}. {c}" for i, c in enumerate(batch)])

    prompt = f"""以下是医学科普文案中观众的困惑。请为每个困惑标注：它在视频中讲解时，最可能需要什么样的医学动画画面？

要求：
- 标签要具体到画面内容，比如"冠状动脉内斑块形成过程"、"心电传导系统示意"、"肾小球滤过机制"
- 一个困惑可以有1-3个标签
- 标签要标准化：相同的画面用相同的措辞
- 如果这个困惑不需要医学动画（比如纯建议类、生活方式类），标注"无需动画"
- 只输出JSON数组，每个元素: {{"id": 编号, "tags": ["标签1", "标签2"]}}

困惑列表：
{confusion_list}"""

    try:
        result = subprocess.run(
            ['claude', '-p', prompt, '--output-format', 'text'],
            capture_output=True, text=True, encoding='utf-8', timeout=300
        )
        text = result.stdout.strip()
        start = text.find('[')
        end = text.rfind(']') + 1
        if start >= 0 and end > start:
            try:
                batch_result = json.loads(text[start:end])
                # Map back to original confusion text
                for item in batch_result:
                    idx = item['id'] - 1
                    if 0 <= idx < len(batch):
                        item['confusion'] = batch[idx]
                all_tagged.extend(batch_result)
                print(f"  Tagged {len(batch_result)} items")
            except json.JSONDecodeError as e:
                print(f"  JSON error: {e}")
        else:
            print(f"  No JSON found")
    except subprocess.TimeoutExpired:
        print(f"  TIMEOUT")

# Save tagged results
with open(r'F:/AI total editing/editing V1/scripts/confusions_tagged.json', 'w', encoding='utf-8') as f:
    json.dump(all_tagged, f, ensure_ascii=False, indent=2)

# Step 2: Collect all tags and count frequency
tag_counts = {}
for item in all_tagged:
    for tag in item.get('tags', []):
        tag_counts[tag] = tag_counts.get(tag, 0) + 1

print(f"\nTotal tagged items: {len(all_tagged)}")
print(f"Unique tags: {len(tag_counts)}")

# Sort by frequency
sorted_tags = sorted(tag_counts.items(), key=lambda x: -x[1])
print(f"\n=== Top 50 tags by frequency ===")
for tag, count in sorted_tags[:50]:
    print(f"  [{count:3d}] {tag}")

# Save tag frequency
with open(r'F:/AI total editing/editing V1/scripts/tag_frequency.json', 'w', encoding='utf-8') as f:
    json.dump(sorted_tags, f, ensure_ascii=False, indent=2)

# Step 3: Cluster similar tags
tag_list = "\n".join([f"- {tag} ({count}次)" for tag, count in sorted_tags])

print(f"\n--- Clustering {len(sorted_tags)} tags ---")

prompt2 = f"""以下是从医学科普文案中提取的"需要什么动画画面"的标签列表及其出现频次。
很多标签描述的其实是同一个画面，请将它们合并聚类。

要求：
1. 不要预设数量，能合并的合并，不能合并的保持独立
2. 合并标准：需要的动画画面基本相同
3. "无需动画"单独一类
4. 每个最终类别取一个最清晰的名称
5. 只输出JSON对象：key是最终类别名，value是它包含的原始标签名数组

标签列表：
{tag_list}"""

try:
    result2 = subprocess.run(
        ['claude', '-p', prompt2, '--output-format', 'text'],
        capture_output=True, text=True, encoding='utf-8', timeout=600
    )
    text2 = result2.stdout.strip()
    start2 = text2.find('{')
    end2 = text2.rfind('}') + 1
    if start2 >= 0 and end2 > start2:
        taxonomy = json.loads(text2[start2:end2])

        # Count total confusions per category
        tag_to_cat = {}
        for cat, tags in taxonomy.items():
            for tag in tags:
                tag_to_cat[tag] = cat

        cat_confusions = {}
        for item in all_tagged:
            for tag in item.get('tags', []):
                cat = tag_to_cat.get(tag, '未分类')
                if cat not in cat_confusions:
                    cat_confusions[cat] = set()
                cat_confusions[cat].add(item.get('confusion', ''))

        with open(r'F:/AI total editing/editing V1/scripts/confusion_taxonomy_v2.json', 'w', encoding='utf-8') as f:
            json.dump(taxonomy, f, ensure_ascii=False, indent=2)

        print(f"\n=== 最终分类体系 ({len(taxonomy)}个分类) ===")
        for cat, tags in sorted(taxonomy.items(), key=lambda x: -len(cat_confusions.get(x[0], set()))):
            n_confusions = len(cat_confusions.get(cat, set()))
            print(f"\n【{cat}】({len(tags)}个标签, 覆盖{n_confusions}个困惑)")
            for tag in tags[:5]:
                print(f"  - {tag}")
            if len(tags) > 5:
                print(f"  ... 共{len(tags)}个标签")
    else:
        print("No JSON in clustering response")
        print(text2[:2000])
except subprocess.TimeoutExpired:
    print("TIMEOUT on clustering")
except json.JSONDecodeError as e:
    print(f"JSON error on clustering: {e}")

print("\nDone!")
