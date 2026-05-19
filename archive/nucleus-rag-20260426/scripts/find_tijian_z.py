"""Scan Z:/阿里云盘Open/鹤立烟雨KP for 体检-related videos.

Criteria for a usable subfolder:
  - contains at least one DOCX
  - contains at least one video (.mp4 / .mov / .mkv)
  - has a 竖版 (vertical) video, i.e. an mp4 whose name does NOT contain '横版'

Then among usable subfolders, identify those whose DOCX mentions 体检,
with snippets so we can judge core-topic vs tangential.
"""
import io
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

try:
    import docx
except ImportError:
    print("python-docx missing", file=sys.stderr)
    sys.exit(1)

ROOT = Path(r"Z:\阿里云盘Open\鹤立烟雨KP")
KEYWORD = "体检"
CONTEXT = 25

VIDEO_EXT = {".mp4", ".mov", ".mkv", ".avi"}

def snippets(text, kw, ctx):
    out, i = [], 0
    while True:
        j = text.find(kw, i)
        if j < 0:
            break
        a = max(0, j - ctx)
        b = min(len(text), j + len(kw) + ctx)
        out.append(text[a:b].replace("\n", " ").replace("\r", " "))
        i = j + len(kw)
    return out


def classify_video(files):
    vids = [f for f in files if f.suffix.lower() in VIDEO_EXT]
    vert, horiz = [], []
    for v in vids:
        stem = v.stem
        if "横版" in stem or "横屏" in stem:
            horiz.append(v)
        else:
            vert.append(v)
    return vert, horiz


results = []
range_dirs = [d for d in ROOT.iterdir() if d.is_dir() and d.name.startswith("鹤立烟雨终版视频")]
range_dirs.sort()

total_subs = 0
usable = 0
for rd in range_dirs:
    try:
        subs = [s for s in rd.iterdir() if s.is_dir()]
    except Exception as e:
        print(f"[ERR listing {rd.name}] {e}", file=sys.stderr)
        continue
    subs.sort()
    for sub in subs:
        total_subs += 1
        try:
            files = list(sub.iterdir())
        except Exception as e:
            results.append((rd.name, sub.name, f"ERR:{e}", 0, [], False, False))
            continue
        docxs = [f for f in files if f.suffix.lower() == ".docx" and not f.name.startswith("~$")]
        vert, horiz = classify_video(files)
        has_docx = bool(docxs)
        has_vert = bool(vert)
        has_horiz = bool(horiz)
        if not has_docx or (not has_vert and not has_horiz):
            results.append((rd.name, sub.name, "NOT_USABLE", 0, [], has_vert, has_horiz))
            continue
        usable += 1
        # read first docx
        d = docxs[0]
        try:
            doc = docx.Document(str(d))
            text = "\n".join(p.text for p in doc.paragraphs)
        except Exception as e:
            results.append((rd.name, sub.name, f"ERR_DOCX:{e}", 0, [], has_vert, has_horiz))
            continue
        count = text.count(KEYWORD)
        in_name = KEYWORD in sub.name or KEYWORD in d.name
        marker = "NAME+MATCH" if (in_name and count > 0) else ("MATCH" if count > 0 else ("NAME_ONLY" if in_name else "-"))
        snips = snippets(text, KEYWORD, CONTEXT) if count > 0 else []
        results.append((rd.name, sub.name, marker, count, snips, has_vert, has_horiz))

# Write report
out_path = Path(r"f:\AI total editing\editing V1\scripts\tijian_z_report.txt")
with open(out_path, "w", encoding="utf-8") as f:
    f.write(f"扫描根: {ROOT}\n")
    f.write(f"总子文件夹: {total_subs}, 可用(有DOCX且有视频): {usable}\n\n")

    matches = [r for r in results if "MATCH" in r[2]]
    matches.sort(key=lambda r: (-r[3], r[1]))
    f.write(f"=== 含'体检'关键字的可用子文件夹 ({len(matches)}) ===\n")
    for rd, sub, marker, count, snips, hv, hh in matches:
        vert_tag = "✓竖版" if hv else "✗无竖版"
        horiz_tag = "+横版" if hh else ""
        f.write(f"\n[{marker}] count={count} {vert_tag}{horiz_tag}\n    {rd} / {sub}\n")
        for s in snips[:6]:
            f.write(f"    … {s} …\n")

    # folders without DOCX/video, limited
    nu = [r for r in results if r[2] == "NOT_USABLE"]
    f.write(f"\n\n=== 不可用(缺 DOCX 或缺视频) 共 {len(nu)} 个，前 20 ===\n")
    for rd, sub, marker, _, _, hv, hh in nu[:20]:
        f.write(f"  {rd} / {sub}  竖={hv} 横={hh}\n")

    errs = [r for r in results if r[2].startswith("ERR")]
    if errs:
        f.write(f"\n=== 出错 {len(errs)} 个 ===\n")
        for rd, sub, marker, *_ in errs:
            f.write(f"  {rd} / {sub}  {marker}\n")

print(f"done. report: {out_path}  total_subs={total_subs} usable={usable} matches={len(matches)}")
