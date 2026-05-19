"""Scan folders under 鹤立烟雨科普终版 and find videos whose DOCX mentions 体检.

Outputs a UTF-8 report with context snippets so we can distinguish core-topic
videos (about 体检) from tangential mentions.
"""
import os
import sys
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

try:
    import docx
except ImportError:
    print("python-docx not installed", file=sys.stderr)
    sys.exit(1)

ROOT = Path(r"P:\团队空间\鹤立烟雨剪辑小组\鹤立烟雨科普终版")
KEYWORD = "体检"
CONTEXT = 25  # chars around each hit

def snippets(text: str, kw: str, ctx: int):
    out = []
    i = 0
    while True:
        j = text.find(kw, i)
        if j < 0:
            break
        a = max(0, j - ctx)
        b = min(len(text), j + len(kw) + ctx)
        snippet = text[a:b].replace("\n", " ").replace("\r", " ")
        out.append(snippet)
        i = j + len(kw)
    return out

results = []
for sub in sorted(ROOT.iterdir()):
    if not sub.is_dir():
        continue
    docxs = [p for p in sub.iterdir() if p.suffix.lower() == ".docx" and not p.name.startswith("~$")]
    if not docxs:
        results.append((sub.name, "NO_DOCX", 0, "", []))
        continue
    # pick the docx whose name best matches folder (just take first)
    for d in docxs[:1]:
        try:
            doc = docx.Document(str(d))
            text = "\n".join(p.text for p in doc.paragraphs)
        except Exception as e:
            results.append((sub.name, f"ERR:{e}", 0, d.name, []))
            continue
        count = text.count(KEYWORD)
        in_name = KEYWORD in sub.name
        marker = "MATCH" if count > 0 else "-"
        if in_name:
            marker = "NAME+" + marker
        snips = snippets(text, KEYWORD, CONTEXT) if count > 0 else []
        results.append((sub.name, marker, count, d.name, snips))

with open(r"f:\AI total editing\editing V1\scripts\tijian_report.txt", "w", encoding="utf-8") as f:
    f.write("=== 含'体检'关键字的视频(按命中数排序) ===\n")
    matches = [r for r in results if "MATCH" in r[1] or "NAME" in r[1]]
    matches.sort(key=lambda r: (-r[2], r[0]))
    for name, marker, count, fn, snips in matches:
        f.write(f"\n[{marker}] count={count}  {name}\n")
        f.write(f"    docx: {fn}\n")
        for s in snips[:6]:
            f.write(f"    … {s} …\n")

    f.write("\n\n=== 没有 DOCX 或出错的文件夹 ===\n")
    for name, marker, count, fn, _ in results:
        if marker == "NO_DOCX" or marker.startswith("ERR"):
            f.write(f"[{marker}] {name}  {fn}\n")

    f.write(f"\n总文件夹数: {len(results)}\n")
    f.write(f"匹配数(含'体检'): {len(matches)}\n")

print("report written to scripts/tijian_report.txt")
