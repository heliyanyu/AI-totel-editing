# -*- coding: utf-8 -*-
import re, sys, json
sys.stdout.reconfigure(encoding='utf-8')

with open(r'F:/wenan qwen/data/heliyanyu KP03.md', 'r', encoding='utf-8') as f:
    content = f.read()

articles = re.split(r'^### \d+\. ', content, flags=re.MULTILINE)[1:]

results = []
for i, art in enumerate(articles):
    lines = art.strip().split('\n')
    title = lines[0].strip().replace('.docx','').replace('.doc','')

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

    hook_lines = []
    for tl in text_lines:
        if tl and not tl.startswith('封面') and not tl.startswith('标题'):
            hook_lines.append(tl)
            if len(hook_lines) >= 2:
                break

    hook = ' '.join(hook_lines)[:150]
    results.append({'id': i+1, 'title': title, 'hook': hook})

for r in results[:50]:
    print(f"{r['id']}. [{r['title'][:50]}] {r['hook']}")
print(f'... total {len(results)}')

# Also save full list to json for further processing
with open(r'F:/AI total editing/editing V1/scripts/all_article_hooks.json', 'w', encoding='utf-8') as out:
    json.dump(results, out, ensure_ascii=False, indent=2)
