# -*- coding: utf-8 -*-
"""
从748篇文案的标题+开头中，归纳出"观众困惑"的分类体系。
用 claude -p 执行。
"""
import json, sys, subprocess
sys.stdout.reconfigure(encoding='utf-8')

with open(r'F:/AI total editing/editing V1/scripts/all_article_hooks.json', 'r', encoding='utf-8') as f:
    articles = json.load(f)

# Split into batches of ~100
batch_size = 50
batches = [articles[i:i+batch_size] for i in range(0, len(articles), batch_size)]
print(f"Total articles: {len(articles)}, batches: {len(batches)}")

# Try to load previous progress
all_confusions = []
raw_path = r'F:/AI total editing/editing V1/scripts/all_confusions_raw.json'
try:
    with open(raw_path, 'r', encoding='utf-8') as f:
        all_confusions = json.load(f)
    if len(all_confusions) > 0:
        # Figure out which batches are done
        done_ids = {item['id'] for item in all_confusions}
        print(f"Loaded {len(all_confusions)} previous results, resuming...")
except:
    done_ids = set()

for bi, batch in enumerate(batches):
    # Skip if all articles in this batch already done
    batch_ids = {a['id'] for a in batch}
    if batch_ids.issubset(done_ids):
        print(f"\n--- Batch {bi+1}/{len(batches)} --- already done, skipping")
        continue

    print(f"\n--- Batch {bi+1}/{len(batches)} ({len(batch)} articles) ---")

    article_list = "\n".join([
        f"{a['id']}. 【{a['title']}】{a['hook']}"
        for a in batch
    ])

    prompt = f"""以下是一批医学科普视频文案的标题和开头。请为每篇文案提取出它解答的核心"观众困惑"，用一句简短的话概括。

注意：
- 困惑不一定是疾病，可能是症状、检查、用药、饮食、生活方式等各种问题
- 如果一篇文案解答了多个困惑，列出主要的1-2个
- 如果文案不是医学科普（比如声明、带货、人设），标注为"非科普"
- 只输出JSON数组，不要其他文字。每个元素: {{"id": 编号, "confusions": ["困惑1", "困惑2"]}}

文案列表：
{article_list}"""

    try:
        result = subprocess.run(
            ['claude', '-p', prompt, '--output-format', 'text'],
            capture_output=True, text=True, encoding='utf-8', timeout=300
        )
        text = result.stdout.strip()
    except subprocess.TimeoutExpired:
        print(f"  TIMEOUT on batch {bi+1}, saving progress and retrying with smaller split...")
        # Save what we have so far
        with open(raw_path, 'w', encoding='utf-8') as f:
            json.dump(all_confusions, f, ensure_ascii=False, indent=2)
        continue
    # Find JSON in response
    start = text.find('[')
    end = text.rfind(']') + 1
    if start >= 0 and end > start:
        try:
            batch_result = json.loads(text[start:end])
            all_confusions.extend(batch_result)
            print(f"  Extracted {len(batch_result)} items")
        except json.JSONDecodeError as e:
            print(f"  WARNING: JSON parse error: {e}")
            # Try to fix common issues and retry
            fixed = text[start:end].replace('\n', ' ')
            try:
                batch_result = json.loads(fixed)
                all_confusions.extend(batch_result)
                print(f"  Extracted {len(batch_result)} items (after fix)")
            except:
                print(f"  FAILED to parse batch {bi+1}, skipping")
                with open(f'F:/AI total editing/editing V1/scripts/batch_{bi+1}_raw.txt', 'w', encoding='utf-8') as dbg:
                    dbg.write(text)
    else:
        print(f"  WARNING: Could not parse JSON from response")
        print(f"  Response: {text[:500]}")

print(f"\nTotal confusions extracted: {len(all_confusions)}")

# Save intermediate result
with open(r'F:/AI total editing/editing V1/scripts/all_confusions_raw.json', 'w', encoding='utf-8') as f:
    json.dump(all_confusions, f, ensure_ascii=False, indent=2)

# Step 2: Collect all unique confusions
all_confusion_texts = []
for item in all_confusions:
    for c in item.get('confusions', []):
        all_confusion_texts.append(c)

print(f"\nTotal confusion mentions: {len(all_confusion_texts)}")
print(f"Unique confusions: {len(set(all_confusion_texts))}")

# Step 3: Ask Claude to cluster these into a taxonomy
confusion_list = "\n".join([f"- {c}" for c in sorted(set(all_confusion_texts))])

print("\n--- Clustering confusions into taxonomy ---")

prompt2 = f"""以下是从748篇医学科普文案中提取的所有"观众困惑"列表。请将它们归纳成一个分类体系。

要求：
1. 分类的目的是给医学动画素材建索引，所以分类应该反映"需要什么样的画面"
2. 每个分类应该包含至少5个困惑，太细的合并，太粗的拆分
3. 分类数量控制在15-30个之间
4. 对于"非科普"内容，单独归为一类
5. 只输出JSON对象，不要其他文字。key是分类名，value是该分类下的困惑列表

困惑列表：
{confusion_list}"""

result2 = subprocess.run(
    ['claude', '-p', prompt2, '--output-format', 'text'],
    capture_output=True, text=True, encoding='utf-8', timeout=600
)

text2 = result2.stdout.strip()
start2 = text2.find('{')
end2 = text2.rfind('}') + 1
if start2 >= 0 and end2 > start2:
    taxonomy = json.loads(text2[start2:end2])

    with open(r'F:/AI total editing/editing V1/scripts/confusion_taxonomy.json', 'w', encoding='utf-8') as f:
        json.dump(taxonomy, f, ensure_ascii=False, indent=2)

    print("\n=== 困惑分类体系 ===")
    for cat, items in taxonomy.items():
        print(f"\n【{cat}】({len(items)}个困惑)")
        for item in items[:5]:
            print(f"  - {item}")
        if len(items) > 5:
            print(f"  ... 共{len(items)}个")
else:
    print("WARNING: Could not parse taxonomy JSON")
    print(text2[:2000])

print("\nDone!")
