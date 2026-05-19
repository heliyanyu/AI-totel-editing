"""Copy vertical (竖版) mp4 of 16 体检 videos from Z: to P:\体检合集\."""
import io
import sys
import shutil
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

Z_ROOT = Path(r"Z:\阿里云盘Open\鹤立烟雨KP")
DEST = Path(r"P:\团队空间\鹤立烟雨剪辑小组\鹤立烟雨科普终版\体检合集")

TARGETS = [
    # (range_dir, subfolder)
    ("鹤立烟雨终版视频 394～405", "403体检十种异常 横版竖版封面 郭安"),
    ("鹤立烟雨终版视频 428～449", "429 最常见的体检套餐 横版竖版封面 大亭亭"),
    ("鹤立烟雨终版视频 428～449", "431 健康体检基本项目 横版竖版封面 大亭亭"),
    ("鹤立烟雨终版视频 428～449", "435常规体检不检查幽门螺旋杆菌 横版竖版封面 大亭亭"),
    ("鹤立烟雨终版视频 450～471", "471 十大体检不需要过度治疗 横版竖版封面 大亭亭"),
    ("鹤立烟雨终版视频 472～493", "493 已婚女性体检 横版竖版封面 大亭亭"),
    ("鹤立烟雨终版视频 580~610", "587 分年龄段体检注意事项 横板竖版封面"),
    ("鹤立烟雨终版视频 580~610", "597 五大最没用的体检项目"),
    ("鹤立烟雨终版视频 580~610", "605 体检心电图到底有没有用"),
    ("鹤立烟雨终版视频 611~631", "612 100块体检"),
    ("鹤立烟雨终版视频815-836", "831 四个异常指标没问题"),
    ("鹤立烟雨终版视频793-814", "808 颈动脉斑块，要吃药吗？"),
    ("鹤立烟雨终版视频859-880", "861 你的肾功能正常吗？"),
    ("鹤立烟雨终版视频752-770", "756 为什么肾衰竭"),
    ("鹤立烟雨终版视频901-921", "902 为什么会肾衰竭"),
    ("鹤立烟雨终版视频901-921", "915 血管斑块，是血管快堵了吗？"),
]

VIDEO_EXT = {".mp4", ".mov", ".mkv"}
HORIZ_MARKERS = ("横版", "横屏")

# Explicit picks for folders with multiple vertical candidates
EXPLICIT_PICKS = {
    "403体检十种异常 横版竖版封面 郭安": "403体检十种异常 竖版 郭安.mp4",
    "861 你的肾功能正常吗？": "861 你的肾功能正常吗？终版.mp4",
}

def pick_vertical(folder: Path):
    files = [f for f in folder.iterdir() if f.suffix.lower() in VIDEO_EXT]
    vert = [f for f in files if not any(m in f.stem for m in HORIZ_MARKERS)]
    explicit = EXPLICIT_PICKS.get(folder.name)
    if explicit:
        chosen = [f for f in vert if f.name == explicit]
        if chosen:
            return files, chosen
    return files, vert

def main(dry: bool):
    DEST.mkdir(parents=True, exist_ok=True)
    plan = []
    missing = []
    ambig = []
    for rng, sub in TARGETS:
        folder = Z_ROOT / rng / sub
        if not folder.is_dir():
            missing.append(str(folder))
            continue
        all_vids, vert = pick_vertical(folder)
        if not vert:
            missing.append(f"{folder}  (no vertical; all={[v.name for v in all_vids]})")
            continue
        if len(vert) > 1:
            ambig.append(f"{folder}  vert_candidates={[v.name for v in vert]}")
            continue
        plan.append(vert[0])

    print(f"=== 计划 ({len(plan)}/16) ===")
    for p in plan:
        size_mb = p.stat().st_size / (1024*1024)
        print(f"  {p.name}  ({size_mb:.1f} MB)")
    if missing:
        print(f"\n=== 缺失 ({len(missing)}) ===")
        for m in missing:
            print(f"  {m}")
    if ambig:
        print(f"\n=== 歧义 ({len(ambig)}) ===")
        for a in ambig:
            print(f"  {a}")

    if dry:
        print("\n(dry-run) 未拷贝")
        return

    if missing or ambig:
        print("\n有缺失或歧义，暂不执行。先修复再重跑。")
        return

    print(f"\n=== 开始拷贝到 {DEST} ===")
    for i, src in enumerate(plan, 1):
        target = DEST / src.name
        if target.exists():
            print(f"  [{i}/{len(plan)}] 跳过(已存在) {src.name}")
            continue
        print(f"  [{i}/{len(plan)}] 拷贝 {src.name} ...", flush=True)
        shutil.copy2(src, target)
        print(f"          完成 ({target.stat().st_size/1024/1024:.1f} MB)")
    print("全部完成。")

if __name__ == "__main__":
    dry = "--run" not in sys.argv
    main(dry)
