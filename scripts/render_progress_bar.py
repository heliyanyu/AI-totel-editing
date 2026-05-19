"""
Python Progress Bar Renderer — 替代 Remotion 渲染 overlay_progress_bar.mp4

读取 visual_plan.json，用 Pillow 逐帧绘制进度条，通过 ffmpeg 编码为 H.264 MP4。
不需要 GPU，纯 CPU 渲染，速度远快于 Remotion。

用法:
  python scripts/render_progress_bar.py <case_out_dir>
  python scripts/render_progress_bar.py path/to/visual_plan.json -o output.mp4
"""

import json
import math
import re
import struct
import subprocess
import sys
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont, ImageFilter

# ── Canvas ────────────────────────────────────────────
VIDEO_W = 1080
VIDEO_H = 1920
FPS = 30

# ── Progress Bar Layout ──────────────────────────────
BAR_TOP = 52
BAR_HEIGHT = 58
TIER2_TOP = 122
TIER2_HEIGHT = 44
TIER2_X = 58
TIER2_W = 964
FONT_SIZE = 34
TIER2_FONT_SIZE = 24
SECTION_PAD_H = 56            # horizontal padding inside each section
BORDER_RADIUS_MD = 14
SEPARATOR_WIDTH = 4
SEPARATOR_VMARGIN = 10
TEXT_STROKE_WIDTH = 2

# ── Color palette (matches reference screenshots) ─────
BAR_PENDING_BG = "#7DB7D9"   # light sky blue
BAR_FILLED_BG = "#2C6FA8"    # darker blue — progress fill
BAR_SEPARATOR = "#B91C1C"    # red separator between sections
TEXT_COLOR = "#FFFFFF"
TEXT_STROKE = "#000000"

# ── Colors ────────────────────────────────────────────
SCENE_TONE_SOLID: dict[str, str] = {
    "brand": "#2563EB",
    "info": "#0EA5E9",
    "warning": "#DC2626",
    "positive": "#16A34A",
    "neutral": "#334155",
}

POSITIVE_COLOR = "#16A34A"
DARK_BASE = "#0F172A"


def hex_to_rgba(hex_color: str, alpha: float = 1.0) -> tuple[int, int, int, int]:
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return (r, g, b, int(alpha * 255))


def rgba_mix(hex_color: str, alpha: float) -> tuple[int, int, int, int]:
    return hex_to_rgba(hex_color, alpha)


# ── Font Loading ──────────────────────────────────────

_font_cache: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}

FONT_CANDIDATES = [
    "C:/Windows/Fonts/msyh.ttc",      # Microsoft YaHei
    "C:/Windows/Fonts/msyhbd.ttc",     # Microsoft YaHei Bold
    "C:/Windows/Fonts/NotoSansSC-Regular.otf",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
]

FONT_BOLD_CANDIDATES = [
    "C:/Windows/Fonts/msyhbd.ttc",     # Microsoft YaHei Bold
    "C:/Windows/Fonts/NotoSansSC-Bold.otf",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc",
]

_resolved_font_path: str | None = None
_resolved_bold_font_path: str | None = None


def _resolve_font_path(candidates: list[str]) -> str | None:
    for path in candidates:
        if Path(path).exists():
            return path
    return None


def get_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    global _resolved_font_path, _resolved_bold_font_path
    key = ("bold" if bold else "regular", size)
    if key in _font_cache:
        return _font_cache[key]

    if bold:
        if _resolved_bold_font_path is None:
            _resolved_bold_font_path = _resolve_font_path(FONT_BOLD_CANDIDATES) or ""
        path = _resolved_bold_font_path
    else:
        if _resolved_font_path is None:
            _resolved_font_path = _resolve_font_path(FONT_CANDIDATES) or ""
        path = _resolved_font_path

    if not path:
        # Fallback: try bold path for regular, regular for bold
        fallback = _resolve_font_path(FONT_BOLD_CANDIDATES if not bold else FONT_CANDIDATES)
        path = fallback or ""

    if path:
        font = ImageFont.truetype(path, size)
    else:
        font = ImageFont.load_default()

    _font_cache[key] = font
    return font


# ── Spring Easing (Remotion-compatible) ───────────────

def spring_value(frame: int, fps: int, mass: float = 1.0,
                 damping: float = 16.0, stiffness: float = 100.0,
                 duration_frames: int = 24) -> float:
    """Compute spring animation value (0→1) matching Remotion's spring()."""
    if frame >= duration_frames:
        return 1.0
    if frame <= 0:
        return 0.0

    # Damped harmonic oscillator
    omega0 = math.sqrt(stiffness / mass)
    zeta = damping / (2 * math.sqrt(stiffness * mass))
    t = frame / fps

    if zeta < 1:  # Under-damped
        omega_d = omega0 * math.sqrt(1 - zeta ** 2)
        value = 1 - math.exp(-zeta * omega0 * t) * (
            math.cos(omega_d * t) + (zeta * omega0 / omega_d) * math.sin(omega_d * t)
        )
    elif zeta == 1:  # Critically damped
        value = 1 - math.exp(-omega0 * t) * (1 + omega0 * t)
    else:  # Over-damped
        s1 = -omega0 * (zeta + math.sqrt(zeta ** 2 - 1))
        s2 = -omega0 * (zeta - math.sqrt(zeta ** 2 - 1))
        value = 1 - (s2 * math.exp(s1 * t) - s1 * math.exp(s2 * t)) / (s2 - s1)

    return max(0.0, min(1.0, value))


def interpolate(value: float, input_range: list[float],
                output_range: list[float]) -> float:
    """Linear interpolation matching Remotion's interpolate()."""
    if value <= input_range[0]:
        return output_range[0]
    if value >= input_range[-1]:
        return output_range[-1]

    for i in range(len(input_range) - 1):
        if input_range[i] <= value <= input_range[i + 1]:
            t = (value - input_range[i]) / (input_range[i + 1] - input_range[i])
            return output_range[i] + t * (output_range[i + 1] - output_range[i])

    return output_range[-1]


# ── Data Types ────────────────────────────────────────

def get_active_segment(frame: int, segments: list[dict]) -> dict | None:
    for seg in segments:
        end = seg["fromFrame"] + seg["contentDurationInFrames"]
        if seg["fromFrame"] <= frame <= end:
            return seg
    return segments[0] if segments else None


def load_progress_nav_labels(visual_plan_path: Path) -> dict | None:
    label_path = visual_plan_path.parent / "progress_nav_labels.json"
    if not label_path.exists():
        return None
    try:
        return json.loads(label_path.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"  [WARN] failed to read progress_nav_labels.json: {exc}", file=sys.stderr)
        return None


def plan_from_progress_nav_labels(labels: dict, fps: int, total_frames: int) -> tuple[list[dict], list[dict]]:
    tier1 = list(labels.get("tier1") or [])
    tier2 = list(labels.get("tier2") or [])
    if not tier1:
        return ([], [])

    nodes: list[dict] = []
    segments: list[dict] = []
    for index, item in enumerate(tier1):
        node_id = str(item.get("id") or f"T{index + 1}")
        start_frame = int(round(float(item.get("start", 0)) * fps))
        end_frame = int(round(float(item.get("end", 0)) * fps))
        if end_frame <= start_frame:
            end_frame = min(total_frames, start_frame + fps)
        children = [sub for sub in tier2 if str(sub.get("parent_id") or "") == node_id]
        subnodes = []
        if not children:
            children = [
                {
                    "id": f"{node_id}-B1",
                    "parent_id": node_id,
                    "label": item.get("label") or node_id,
                    "start": item.get("start", 0),
                    "end": item.get("end", 0),
                    "covers": item.get("covers_vu") or [node_id],
                }
            ]
        for child_index, child in enumerate(children):
            seg_id = str(child.get("id") or f"{node_id}-B{child_index + 1}")
            child_start = int(round(float(child.get("start", item.get("start", 0))) * fps))
            child_end = int(round(float(child.get("end", item.get("end", 0))) * fps))
            if child_end <= child_start:
                child_end = min(total_frames, child_start + max(1, end_frame - start_frame))
            duration = max(1, child_end - child_start)
            label = str(child.get("label") or item.get("label") or seg_id)
            subnodes.append({
                "id": seg_id,
                "label": label,
                "fromFrame": child_start,
                "durationInFrames": duration,
                "endFrame": child_end,
            })
            segments.append({
                "key": seg_id,
                "fromFrame": child_start,
                "contentDurationInFrames": duration,
                "topicId": node_id,
                "topicSegmentIndex": child_index,
                "label": label,
                "tone": "brand",
            })
        nodes.append({
            "id": node_id,
            "label": str(item.get("label") or node_id),
            "sceneIds": list(item.get("covers_vu") or [node_id]),
            "subNodes": subnodes,
        })
    return (nodes, sorted(segments, key=lambda seg: int(seg["fromFrame"])))


def get_node_states(active_topic_id: str | None,
                    nodes: list[dict]) -> dict[str, str]:
    states: dict[str, str] = {}
    active_index = -1
    for i, node in enumerate(nodes):
        if node["id"] == active_topic_id:
            active_index = i
            break

    for i, node in enumerate(nodes):
        if active_index == -1 or i > active_index:
            states[node["id"]] = "pending"
        elif i < active_index:
            states[node["id"]] = "completed"
        else:
            states[node["id"]] = "active"
    return states


# ── Drawing Helpers ───────────────────────────────────

def draw_rounded_rect(draw: ImageDraw.ImageDraw, xy: tuple[int, int, int, int],
                      radius: int, fill: tuple | None = None,
                      outline: tuple | None = None, width: int = 1):
    """Draw a rounded rectangle with optional fill and outline."""
    x1, y1, x2, y2 = xy
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


def draw_circle(draw: ImageDraw.ImageDraw, cx: int, cy: int, r: int,
                fill: tuple | None = None):
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)


def draw_checkmark(draw: ImageDraw.ImageDraw, cx: int, cy: int, size: int = 12):
    """Draw a checkmark SVG path scaled to fit in a circle."""
    # Original SVG path: M6 13 L10.5 17.5 L18 8 in 24x24 viewBox
    # Scale to fit in `size` px
    s = size / 24.0
    ox = cx - size // 2
    oy = cy - size // 2
    points = [
        (ox + 6 * s, oy + 13 * s),
        (ox + 10.5 * s, oy + 17.5 * s),
        (ox + 18 * s, oy + 8 * s),
    ]
    draw.line(points, fill=(255, 255, 255, 255), width=max(1, int(3 * s)))


def measure_text_width(text: str, font: ImageFont.FreeTypeFont) -> int:
    bbox = font.getbbox(text)
    return bbox[2] - bbox[0]


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def shorten_text(text: str, max_chars: int) -> str:
    cleaned = re.sub(r"\s+", "", str(text or ""))
    cleaned = re.sub(r"[，。！？、；：,.!?:;【】\[\]（）()]", "", cleaned)
    if len(cleaned) <= max_chars:
        return cleaned
    if max_chars <= 3:
        return cleaned[:max_chars]
    return cleaned[: max_chars - 3] + "..."


def progress_label(text: str, level: str) -> str:
    """Compress narration-like text into navigation labels.

    Progress-bar labels should read like a table of contents, not subtitles.
    Keep them short, stable, and semantic.
    """
    raw = str(text or "")
    t = re.sub(r"\s+", "", raw)

    scene_rules = [
        ("开场", "开场"),
        ("标题", "开场"),
        ("收藏视频好好听", "开场"),
        ("得了肾病不能干", "开场"),
        ("得了肾病", "开场"),
        ("六件事", "开场"),
        ("布洛芬", "乱吃药"),
        ("双氯芬酸", "乱吃药"),
        ("止痛", "乱吃药"),
        ("消炎", "乱吃药"),
        ("遵医嘱", "乱吃药"),
        ("高盐", "控盐"),
        ("盐", "控盐"),
        ("烧烤", "控盐"),
        ("火锅", "控盐"),
        ("喝水", "饮水"),
        ("饮水", "饮水"),
        ("水肿", "饮水"),
        ("尿少", "饮水"),
        ("运动", "运动"),
        ("跑步", "运动"),
        ("劳累", "运动"),
        ("感染", "防感染"),
        ("感冒", "防感染"),
        ("发烧", "防感染"),
        ("熬夜", "睡眠"),
        ("睡", "睡眠"),
        ("偏方", "偏方"),
        ("秘方", "偏方"),
        ("补肾产品", "偏方"),
        ("保健品", "偏方"),
        ("不明成分", "偏方"),
        ("轻信", "偏方"),
        ("肾功能受损", "别劳累"),
        ("过度劳累", "别劳累"),
        ("剧烈运动", "别劳累"),
        ("滤过", "别劳累"),
        ("护肾没有捷径", "总结"),
        ("护肾", "总结"),
        ("伤肾行为", "总结"),
        ("复查", "复查"),
        ("肌酐", "复查"),
        ("尿蛋白", "复查"),
        ("总结", "总结"),
        ("鱼油", "鱼油"),
        ("牛初乳", "牛初乳"),
        ("灵芝", "灵芝"),
        ("免疫力", "免疫力"),
        ("三件", "三件事"),
        ("收尾", "收尾"),
    ]
    sub_rules = [
        ("几十块", "嫌贵"),
        ("嫌贵", "嫌贵"),
        ("吃错", "出事"),
        ("掀", "底牌"),
        ("听完", "先听"),
        ("神药", "神药?"),
        ("奉为", "神药?"),
        ("两个", "两问题"),
        ("天生", "两问题"),
        ("10%", "+10%"),
        ("百分之十", "+10%"),
        ("心脏不好", "房颤"),
        ("房颤", "房颤"),
        ("阿司匹林", "叠加"),
        ("氯吡格雷", "叠加"),
        ("利伐沙班", "叠加"),
        ("吃鱼", "决策"),
        ("人吃", "人无效"),
        ("针对牛", "牛抗体"),
        ("效果有限", "人无效"),
        ("抗体", "抗体"),
        ("小牛", "小牛"),
        ("昂贵", "性价比"),
        ("孢子", "孢子粉"),
        ("破壁", "破壁"),
        ("你提高", "拉高?"),
        ("提高", "拉高?"),
        ("提高免疫", "拉高?"),
        ("越高", "误区"),
        ("太低", "平衡"),
        ("太高", "平衡"),
        ("类风湿", "过强"),
        ("红斑", "过强"),
        ("桥本", "过强"),
        ("过强", "过强"),
        ("伤身", "过强"),
        ("目标是", "求稳"),
        ("目标是平衡", "求稳"),
        ("目标是稳", "求稳"),
        ("晒太阳", "晒太阳"),
        ("150", "运动"),
        ("走路", "运动"),
        ("早睡", "早睡"),
        ("熬夜", "早睡"),
        ("布洛芬", "止痛药"),
        ("双氯芬酸", "止痛药"),
        ("止痛", "止痛药"),
        ("消炎", "消炎药"),
        ("遵医嘱", "遵医嘱"),
        ("高盐", "盐吃多"),
        ("盐吃多", "盐多"),
        ("盐", "控盐"),
        ("烧烤", "重口味"),
        ("火锅", "重口味"),
        ("喝水", "喝水"),
        ("饮水", "饮水"),
        ("水肿", "水肿"),
        ("尿少", "尿少"),
        ("运动", "运动"),
        ("跑步", "运动"),
        ("高强度", "强运动"),
        ("劳累", "劳累"),
        ("感染", "感染"),
        ("感冒", "感冒"),
        ("发烧", "发烧"),
        ("熬夜", "熬夜"),
        ("睡眠", "睡眠"),
        ("偏方", "偏方"),
        ("秘方", "偏方"),
        ("补肾产品", "补肾品"),
        ("保健品", "保健品"),
        ("不明成分", "成分不明"),
        ("肾功能受损", "肾受损"),
        ("过度劳累", "别劳累"),
        ("剧烈运动", "强运动"),
        ("护肾没有捷径", "无捷径"),
        ("护肾", "护肾"),
        ("复查", "复查"),
        ("肌酐", "肌酐"),
        ("尿蛋白", "尿蛋白"),
        ("大钱", "少花钱"),
        ("几千", "吃真食"),
        ("鱼虾", "吃真食"),
        ("水果", "吃真食"),
        ("转给", "转发"),
        ("转发", "转发"),
        ("更多", "关注"),
        ("关注", "关注"),
    ]

    rules = scene_rules if level == "scene" else sub_rules
    for keyword, label in rules:
        if keyword in t:
            return label

    cleaned = re.sub(
        r"(的真相|的底牌|真的吗|真的|问题|风险|需要|完全|不是|可以|应该|医生|提醒|宣称)",
        "",
        t,
    )
    return shorten_text(cleaned or t, 4 if level == "scene" else 3)


def is_generic_scene_label(text: str) -> bool:
    t = re.sub(r"\s+", "", str(text or ""))
    return bool(re.match(r"^(口播片段|口播|场景|片段|Scene|S)\d*$", t, re.I))


def inferred_topic_label(node: dict, nodes: list[dict],
                         segments: list[dict]) -> str:
    raw = str(node.get("label") or node.get("id") or "")
    if not is_generic_scene_label(raw):
        return raw

    subs = get_subnodes_for_topic(node.get("id"), nodes, segments)
    topic_segments = [s for s in segments if s.get("topicId") == node.get("id")]
    context_parts = [
        str(item.get("label") or "")
        for item in (subs if subs else topic_segments)
    ]
    context = "".join(context_parts)
    label = progress_label(context, "scene")
    return label if label and not is_generic_scene_label(label) else raw


def inferred_sub_label(sub: dict, idx: int, subnodes: list[dict]) -> str:
    raw = str(sub.get("label") or idx + 1)
    t = re.sub(r"\s+", "", raw)
    if is_ordinal_marker(t) and idx + 1 < len(subnodes):
        context = raw + str(subnodes[idx + 1].get("label") or "")
        if idx + 2 < len(subnodes):
            context += str(subnodes[idx + 2].get("label") or "")
        return progress_label(context, "sub")
    return progress_label(raw, "sub")


def is_marker_only_node(node: dict, nodes: list[dict], segments: list[dict]) -> bool:
    subs = get_subnodes_for_topic(node.get("id"), nodes, segments)
    return bool(subs) and all(is_ordinal_marker(str(sub.get("label") or "")) for sub in subs)


def virtual_x_for_frame(frame: int,
                        node_ranges: list[tuple[int, int]],
                        section_widths: list[int]) -> float:
    cursor = 0.0
    if not node_ranges or not section_widths:
        return 0.0
    for (start, end), width in zip(node_ranges, section_widths):
        if frame <= start:
            return cursor
        if start <= frame <= end:
            return cursor + clamp((frame - start) / max(1, end - start), 0.0, 1.0) * width
        cursor += width
    return sum(section_widths)


def is_ordinal_marker(text: str) -> bool:
    t = re.sub(r"\s+", "", str(text or ""))
    return bool(re.fullmatch(r"第[一二三四五六七八九十]+[呢、]?", t))


def ordinal_token(text: str) -> str | None:
    m = re.search(r"(第[一二三四五六七八九十]+)", str(text or ""))
    return m.group(1) if m else None


def scene_text_from_blueprint(scene: dict) -> str:
    parts: list[str] = []
    for segment in scene.get("logic_segments") or []:
        for item in segment.get("items") or []:
            parts.append(str(item.get("text") or ""))
    return "".join(parts)


def enrich_nodes_from_blueprint(nodes: list[dict], visual_plan_path: Path) -> list[dict]:
    """Use blueprint scene text to label generic "口播片段 N" topic nodes.

    When Step2 is skipped, scene titles are placeholders. The progress bar should
    still read like a table of contents, so we recover labels from the richer
    blueprint items next to visual_plan.json.
    """
    blueprint_path = visual_plan_path.parent / "blueprint.json"
    if not blueprint_path.exists():
        return nodes
    try:
        blueprint = json.loads(blueprint_path.read_text(encoding="utf-8"))
    except Exception:
        return nodes

    scenes = list(blueprint.get("scenes") or [])
    scene_text = {
        str(scene.get("id")): scene_text_from_blueprint(scene)
        for scene in scenes
    }
    scene_order = [str(scene.get("id")) for scene in scenes]

    def semantic_for_scene(scene_id: str, text: str) -> str:
        label = progress_label(text, "scene")
        token = ordinal_token(text)
        if token and (is_ordinal_marker(text) or label.startswith("第")):
            try:
                start_idx = scene_order.index(scene_id) + 1
            except ValueError:
                start_idx = 0
            for next_id in scene_order[start_idx:]:
                next_text = scene_text.get(next_id, "")
                if token in next_text and not is_ordinal_marker(next_text):
                    next_label = progress_label(next_text, "scene")
                    if next_label and not next_label.startswith("第"):
                        return next_label
        return label

    enriched: list[dict] = []
    for node in nodes:
        node_id = str(node.get("id") or "")
        raw_label = str(node.get("label") or "")
        text = scene_text.get(node_id, "")
        if text and is_generic_scene_label(raw_label):
            updated = dict(node)
            updated["label"] = semantic_for_scene(node_id, text)
            enriched.append(updated)
        else:
            enriched.append(node)
    return enriched


def fit_text_to_width(text: str, font: ImageFont.FreeTypeFont,
                      max_width: int, max_chars: int) -> str:
    for limit in range(max_chars, 0, -1):
        candidate = shorten_text(text, limit)
        if measure_text_width(candidate, font) <= max_width:
            return candidate
    return ""


def get_subnodes_for_topic(active_topic_id: str | None,
                           nodes: list[dict],
                           segments: list[dict]) -> list[dict]:
    if not active_topic_id:
        return []
    for node in nodes:
        if node.get("id") == active_topic_id and node.get("subNodes"):
            return list(node.get("subNodes") or [])
    result = []
    for index, seg in enumerate(s for s in segments if s.get("topicId") == active_topic_id):
        start = int(seg["fromFrame"])
        duration = int(seg["contentDurationInFrames"])
        result.append({
            "id": seg.get("key") or f"{active_topic_id}-{index + 1}",
            "label": seg.get("label") or str(index + 1),
            "fromFrame": start,
            "durationInFrames": duration,
            "endFrame": start + duration,
        })
    return result


def frame_range_for_subnodes(subnodes: list[dict]) -> tuple[int, int]:
    if not subnodes:
        return (0, 1)
    start = min(int(n.get("fromFrame", 0)) for n in subnodes)
    end = max(int(n.get("endFrame", int(n.get("fromFrame", 0)) + int(n.get("durationInFrames", 1)))) for n in subnodes)
    return (start, max(start + 1, end))


def get_active_subnode(frame: int, subnodes: list[dict]) -> dict | None:
    for node in subnodes:
        start = int(node.get("fromFrame", 0))
        end = int(node.get("endFrame", start + int(node.get("durationInFrames", 1))))
        if start <= frame <= end:
            return node
    return subnodes[0] if subnodes else None


# ── Chip Renderer ─────────────────────────────────────

def compute_chip_width(label: str, compact: bool) -> int:
    font_size = 36 if compact else FONT_SIZE
    font = get_font(font_size)
    text_w = measure_text_width(label, font)
    indicator_size = 34 if compact else 40
    gap = 8 if compact else 10
    pad_l = 14 if compact else 18
    pad_r = 20 if compact else 24
    return pad_l + indicator_size + gap + text_w + pad_r


def render_chip(img: Image.Image, x: int, y: int, label: str, index: int,
                state: str, tone_color: str, breathe_scale: float,
                compact: bool) -> int:
    """Render a chip at (x, y) and return its width."""
    font_size = 36 if compact else FONT_SIZE
    indicator_size = 34 if compact else 40
    gap = 8 if compact else 10
    pad_top = 12 if compact else 14
    pad_bottom = 12 if compact else 14
    pad_l = 14 if compact else 18
    pad_r = 20 if compact else 24
    chip_h = pad_top + max(indicator_size, int(font_size * 1.2)) + pad_bottom

    font = get_font(font_size, bold=(state == "active"))
    text_w = measure_text_width(label, font)
    chip_w = pad_l + indicator_size + gap + text_w + pad_r

    # Create chip on a separate RGBA image for potential scaling
    chip_img = Image.new("RGBA", (chip_w + 4, chip_h + 4), (0, 0, 0, 0))
    cd = ImageDraw.Draw(chip_img)

    # Colors by state
    if state == "active":
        bg = hex_to_rgba(tone_color)
        text_color = (255, 255, 255, 255)
        border_color = hex_to_rgba(tone_color)
        indicator_bg = (255, 255, 255, 77)  # rgba(255,255,255,0.30)
    elif state == "completed":
        bg = (255, 255, 255, 245)  # rgba(255, 255, 255, 0.96)
        text_color = rgba_mix(DARK_BASE, 0.88)
        border_color = hex_to_rgba(POSITIVE_COLOR, 0.4)
        indicator_bg = hex_to_rgba(POSITIVE_COLOR)
    else:  # pending
        bg = (255, 255, 255, 184)  # rgba(255, 255, 255, 0.72)
        text_color = rgba_mix(DARK_BASE, 0.5)
        border_color = rgba_mix(DARK_BASE, 0.1)
        indicator_bg = rgba_mix(DARK_BASE, 0.08)

    # Draw chip background
    draw_rounded_rect(cd, (1, 1, chip_w + 1, chip_h + 1),
                      radius=BORDER_RADIUS_MD, fill=bg, outline=border_color, width=2)

    # Draw indicator circle
    ind_cx = 1 + pad_l + indicator_size // 2
    ind_cy = 1 + chip_h // 2
    ind_r = indicator_size // 2
    draw_circle(cd, ind_cx, ind_cy, ind_r, fill=indicator_bg)

    # Indicator content
    if state == "active":
        # White filled dot
        draw_circle(cd, ind_cx, ind_cy, 5, fill=(255, 255, 255, 255))
    elif state == "completed":
        draw_checkmark(cd, ind_cx, ind_cy, size=indicator_size)
    else:
        # Number
        num_font = get_font(16)
        num_text = str(index + 1)
        num_color = rgba_mix(DARK_BASE, 0.45)
        num_w = measure_text_width(num_text, num_font)
        num_bbox = num_font.getbbox(num_text)
        num_h = num_bbox[3] - num_bbox[1]
        cd.text((ind_cx - num_w // 2, ind_cy - num_h // 2 - num_bbox[1]),
                num_text, fill=num_color, font=num_font)

    # Draw label text
    text_x = 1 + pad_l + indicator_size + gap
    text_bbox = font.getbbox(label)
    text_h = text_bbox[3] - text_bbox[1]
    text_y = 1 + chip_h // 2 - text_h // 2 - text_bbox[1]
    cd.text((text_x, text_y), label, fill=text_color, font=font)

    # Apply breathing scale if needed
    if abs(breathe_scale - 1.0) > 0.001:
        new_w = int(chip_img.width * breathe_scale)
        new_h = int(chip_img.height * breathe_scale)
        chip_img = chip_img.resize((new_w, new_h), Image.LANCZOS)
        offset_x = (chip_img.width - (chip_w + 4)) // 2
        offset_y = (chip_img.height - (chip_h + 4)) // 2
        img.alpha_composite(chip_img, (x - offset_x, y - offset_y))
    else:
        img.alpha_composite(chip_img, (x, y))

    return chip_w


def render_connector(draw: ImageDraw.ImageDraw, x: int, y: int,
                     prev_state: str):
    """Render a connector line between chips."""
    if prev_state == "completed":
        color = hex_to_rgba(POSITIVE_COLOR, 0.5)
    else:
        color = rgba_mix(DARK_BASE, 0.12)

    line_w = 18
    line_h = 3
    draw.rectangle(
        [x, y - line_h // 2, x + line_w, y + line_h // 2],
        fill=color,
    )


# ── Frame Renderer ────────────────────────────────────

def render_frame(frame: int, fps: int, segments: list[dict],
                 nodes: list[dict]) -> Image.Image:
    """Render a single progress bar frame (1080x1920 RGBA).

    Layout: a virtual bar wider than the canvas. Each topic section is sized
    by its own label width (plus fixed padding) so text never collapses. As
    progress advances 0→1, the bar scrolls left so later sections come into
    view, and a darker "filled" color grows left→right across the whole
    virtual bar to indicate overall progress. Red rules separate sections;
    labels are bold white with a black stroke.
    """
    img = Image.new("RGBA", (VIDEO_W, VIDEO_H), (0, 0, 0, 0))

    if not nodes or not segments:
        return img

    total_span = max(
        s["fromFrame"] + s["contentDurationInFrames"] for s in segments
    )
    if total_span <= 0:
        return img

    # Entry animation (spring slide-in from top).
    entry = spring_value(frame, fps, mass=1.0, damping=16.0,
                         stiffness=100.0, duration_frames=24)
    translate_y = interpolate(entry, [0, 1], [-(BAR_HEIGHT + BAR_TOP), 0])
    entry_opacity = interpolate(entry, [0, 0.4, 1], [0, 0.5, 1])
    if entry_opacity < 0.01:
        return img

    # Natural section widths: whatever each label needs plus fixed padding.
    label_font = get_font(FONT_SIZE, bold=True)
    section_widths = [
        measure_text_width(n["label"], label_font) + 2 * SECTION_PAD_H
        for n in nodes
    ]
    total_bar_w = sum(section_widths)
    if total_bar_w <= 0:
        return img

    # Build the virtual bar (may be wider than VIDEO_W).
    virtual = Image.new("RGBA", (total_bar_w, BAR_HEIGHT + 4), (0, 0, 0, 0))
    vd = ImageDraw.Draw(virtual)

    pending_rgba = hex_to_rgba(BAR_PENDING_BG)
    filled_rgba = hex_to_rgba(BAR_FILLED_BG)
    separator_rgba = hex_to_rgba(BAR_SEPARATOR)
    text_rgba = hex_to_rgba(TEXT_COLOR)
    stroke_rgba = hex_to_rgba(TEXT_STROKE)

    draw_rounded_rect(
        vd, (0, 0, total_bar_w, BAR_HEIGHT),
        radius=BORDER_RADIUS_MD, fill=pending_rgba,
    )

    progress = min(1.0, max(0.0, frame / total_span))
    fill_w = int(progress * total_bar_w)
    if fill_w > 0:
        fill_scratch = Image.new("RGBA", (total_bar_w, BAR_HEIGHT), (0, 0, 0, 0))
        fs = ImageDraw.Draw(fill_scratch)
        fs.rounded_rectangle(
            (0, 0, total_bar_w, BAR_HEIGHT),
            radius=BORDER_RADIUS_MD, fill=filled_rgba,
        )
        virtual.alpha_composite(
            fill_scratch.crop((0, 0, fill_w, BAR_HEIGHT)), (0, 0)
        )

    # Section separators and labels on the virtual bar.
    cursor = 0
    for idx, node in enumerate(nodes):
        sw = section_widths[idx]
        section_left = cursor

        if idx > 0:
            sep_x = section_left
            vd.rectangle(
                [sep_x - SEPARATOR_WIDTH // 2, SEPARATOR_VMARGIN,
                 sep_x + SEPARATOR_WIDTH // 2 + SEPARATOR_WIDTH % 2,
                 BAR_HEIGHT - SEPARATOR_VMARGIN],
                fill=separator_rgba,
            )

        label = node["label"]
        tw = measure_text_width(label, label_font)
        tbbox = label_font.getbbox(label)
        th = tbbox[3] - tbbox[1]
        tx = int(section_left + sw / 2 - tw / 2)
        ty = int(BAR_HEIGHT / 2 - th / 2 - tbbox[1])
        vd.text(
            (tx, ty), label,
            fill=text_rgba, font=label_font,
            stroke_width=TEXT_STROKE_WIDTH, stroke_fill=stroke_rgba,
        )

        cursor += sw

    # Scroll: bar left edge aligned with canvas at progress=0, right edge
    # aligned with canvas right at progress=1. If the bar happens to fit,
    # center it and don't scroll.
    if total_bar_w > VIDEO_W:
        scroll = -progress * (total_bar_w - VIDEO_W)
    else:
        scroll = (VIDEO_W - total_bar_w) / 2

    # Crop the virtual bar to the visible window. With scroll ≤ 0 the window
    # lands inside virtual coords [-scroll, -scroll+VIDEO_W]. Negative scroll
    # bounds are safe because virtual is at least VIDEO_W wide here.
    visible_left = int(round(-scroll))
    if total_bar_w > VIDEO_W:
        crop_box = (visible_left, 0, visible_left + VIDEO_W, virtual.height)
        window = virtual.crop(crop_box)
        dest_x = 0
    else:
        window = virtual
        dest_x = int(round(scroll))

    if entry_opacity < 1.0:
        alpha = window.split()[3]
        alpha = alpha.point(lambda p: int(p * entry_opacity))
        window.putalpha(alpha)

    bar_y = int(BAR_TOP + translate_y)
    img.alpha_composite(window, (dest_x, bar_y))
    return img


# ── Video Encoding ────────────────────────────────────

def render_frame_tiered(frame: int, fps: int, segments: list[dict],
                        nodes: list[dict]) -> Image.Image:
    """Render two hierarchy levels without turning the bar into boxes."""
    img = Image.new("RGBA", (VIDEO_W, VIDEO_H), (0, 0, 0, 0))
    if not nodes or not segments:
        return img

    total_span = max(s["fromFrame"] + s["contentDurationInFrames"] for s in segments)
    if total_span <= 0:
        return img

    entry = spring_value(frame, fps, mass=1.0, damping=16.0,
                         stiffness=100.0, duration_frames=24)
    translate_y = interpolate(entry, [0, 1], [-(TIER2_TOP + TIER2_HEIGHT), 0])
    entry_opacity = interpolate(entry, [0, 0.4, 1], [0, 0.5, 1])
    if entry_opacity < 0.01:
        return img

    active_segment = get_active_segment(frame, segments)
    active_topic_id = active_segment.get("topicId") if active_segment else None

    nodes = [
        node for node in nodes
        if get_subnodes_for_topic(node.get("id"), nodes, segments)
        or any(seg.get("topicId") == node.get("id") for seg in segments)
    ]
    nodes = [
        node for node in nodes
        if not is_marker_only_node(node, nodes, segments)
    ]
    if not nodes:
        return img

    label_font = get_font(FONT_SIZE, bold=True)
    node_ranges = []
    for node in nodes:
        subs = get_subnodes_for_topic(node.get("id"), nodes, segments)
        if subs:
            start, end = frame_range_for_subnodes(subs)
        else:
            topic_segments = [s for s in segments if s.get("topicId") == node.get("id")]
            if topic_segments:
                start = min(int(s["fromFrame"]) for s in topic_segments)
                end = max(int(s["fromFrame"]) + int(s["contentDurationInFrames"]) for s in topic_segments)
            else:
                start, end = 0, 1
        node_ranges.append((start, max(start + 1, end)))

    scene_durations = [end - start for start, end in node_ranges]
    dense_tier1 = len(nodes) > 7
    min_scene_w = 148 if dense_tier1 else 72
    total_bar_w = max(VIDEO_W, min_scene_w * len(nodes)) if dense_tier1 else VIDEO_W
    remaining_w = max(1, total_bar_w - min_scene_w * len(nodes))
    duration_sum = max(1, sum(scene_durations))
    section_widths = [
        int(round(min_scene_w + remaining_w * duration / duration_sum))
        for duration in scene_durations
    ]
    width_delta = total_bar_w - sum(section_widths)
    if section_widths:
        section_widths[-1] += width_delta
    if total_bar_w <= 0:
        return img

    virtual = Image.new("RGBA", (total_bar_w, BAR_HEIGHT + 8), (0, 0, 0, 0))
    vd = ImageDraw.Draw(virtual)
    pending_rgba = hex_to_rgba(BAR_PENDING_BG)
    filled_rgba = hex_to_rgba(BAR_FILLED_BG)
    separator_rgba = hex_to_rgba(BAR_SEPARATOR)
    text_rgba = hex_to_rgba(TEXT_COLOR)
    stroke_rgba = hex_to_rgba(TEXT_STROKE)

    draw_rounded_rect(vd, (0, 0, total_bar_w, BAR_HEIGHT),
                      radius=BORDER_RADIUS_MD, fill=pending_rgba)
    fill_w = int(virtual_x_for_frame(frame, node_ranges, section_widths))
    if fill_w > 0:
        fill_scratch = Image.new("RGBA", (total_bar_w, BAR_HEIGHT), (0, 0, 0, 0))
        fs = ImageDraw.Draw(fill_scratch)
        fs.rounded_rectangle((0, 0, total_bar_w, BAR_HEIGHT),
                             radius=BORDER_RADIUS_MD, fill=filled_rgba)
        virtual.alpha_composite(fill_scratch.crop((0, 0, fill_w, BAR_HEIGHT)), (0, 0))
        lead_x = max(0, min(total_bar_w - 4, fill_w - 4))
        vd.rounded_rectangle((lead_x, 5, min(total_bar_w, lead_x + 10), BAR_HEIGHT - 5),
                             radius=5, fill=(255, 255, 255, 130))

    cursor = 0
    active_center_virtual = 0
    for idx, node in enumerate(nodes):
        sw = section_widths[idx]
        section_left = cursor
        if node.get("id") == active_topic_id:
            active_center_virtual = section_left + sw / 2
        if idx > 0:
            sep_x = section_left
            vd.rectangle(
                [sep_x - SEPARATOR_WIDTH // 2, SEPARATOR_VMARGIN,
                 sep_x + SEPARATOR_WIDTH // 2 + SEPARATOR_WIDTH % 2,
                 BAR_HEIGHT - SEPARATOR_VMARGIN],
                fill=separator_rgba,
            )
        node_label = inferred_topic_label(node, nodes, segments)
        label = fit_text_to_width(
            progress_label(node_label, "scene"),
            label_font,
            max(0, sw - 18),
            4,
        )
        tw = measure_text_width(label, label_font)
        tbbox = label_font.getbbox(label)
        th = tbbox[3] - tbbox[1]
        tx = int(section_left + sw / 2 - tw / 2)
        ty = int(BAR_HEIGHT / 2 - th / 2 - tbbox[1])
        vd.text((tx, ty), label, fill=text_rgba, font=label_font,
                stroke_width=TEXT_STROKE_WIDTH, stroke_fill=stroke_rgba)
        cursor += sw

    if total_bar_w > VIDEO_W:
        target_x = fill_w - VIDEO_W * 0.44
        scroll = int(clamp(target_x, 0, total_bar_w - VIDEO_W))
    else:
        scroll = 0

    visible_left = int(round(scroll))
    window = virtual.crop((visible_left, 0, visible_left + VIDEO_W, virtual.height))
    dest_x = 0

    if entry_opacity < 1.0:
        alpha = window.split()[3]
        alpha = alpha.point(lambda p: int(p * entry_opacity))
        window.putalpha(alpha)

    bar_y = int(BAR_TOP + translate_y)
    img.alpha_composite(window, (dest_x, bar_y))

    subnodes = get_subnodes_for_topic(active_topic_id, nodes, segments)
    if not subnodes:
        return img

    sub_start, sub_end = frame_range_for_subnodes(subnodes)
    sub_progress = clamp((frame - sub_start) / (sub_end - sub_start), 0.0, 1.0)
    sub_y = int(TIER2_TOP + translate_y)
    tier2 = Image.new("RGBA", (TIER2_W, TIER2_HEIGHT + 20), (0, 0, 0, 0))
    td = ImageDraw.Draw(tier2)
    td.rounded_rectangle((0, 0, TIER2_W, TIER2_HEIGHT), radius=12,
                         fill=(255, 255, 255, int(0.82 * 255)),
                         outline=(15, 23, 42, 42), width=1)
    td.rounded_rectangle((3, 3, TIER2_W - 3, TIER2_HEIGHT - 3), radius=10,
                         fill=hex_to_rgba("#D8ECFA", 0.92))

    sub_fill_w = int((TIER2_W - 6) * sub_progress)
    if sub_fill_w > 0:
        fill_layer = Image.new("RGBA", (TIER2_W - 6, TIER2_HEIGHT - 6), (0, 0, 0, 0))
        fd = ImageDraw.Draw(fill_layer)
        fd.rounded_rectangle((0, 0, TIER2_W - 6, TIER2_HEIGHT - 6),
                             radius=10, fill=hex_to_rgba("#1D7FB8", 0.98))
        tier2.alpha_composite(fill_layer.crop((0, 0, sub_fill_w, TIER2_HEIGHT - 6)), (3, 3))
        lead_x = 3 + max(0, min(TIER2_W - 12, sub_fill_w - 5))
        td.rounded_rectangle((lead_x, 6, min(TIER2_W - 6, lead_x + 10), TIER2_HEIGHT - 6),
                             radius=5, fill=(255, 255, 255, 135))

    active_subnode = get_active_subnode(frame, subnodes)
    topic_duration = max(1, sub_end - sub_start)
    segment_cursor = 0.0
    tier_font = get_font(TIER2_FONT_SIZE, bold=True)
    small_font = get_font(max(18, TIER2_FONT_SIZE - 4), bold=False)
    for idx, sub in enumerate(subnodes):
        start = int(sub.get("fromFrame", sub_start))
        end = int(sub.get("endFrame", start + int(sub.get("durationInFrames", 1))))
        duration = max(1, end - start)
        seg_w = max(42, duration / topic_duration * TIER2_W)
        if idx == len(subnodes) - 1:
            seg_w = TIER2_W - segment_cursor
        left = int(round(segment_cursor))
        right = int(round(segment_cursor + seg_w))
        if idx > 0:
            td.line([(left, 8), (left, TIER2_HEIGHT - 8)],
                    fill=(185, 28, 28, 170), width=2)
        is_active = bool(active_subnode and sub.get("id") == active_subnode.get("id"))
        font = tier_font if is_active else small_font
        available_w = max(0, right - left - 12)
        sub_label = inferred_sub_label(sub, idx, subnodes)
        label = fit_text_to_width(sub_label, font, available_w, 5)
        if not label and right - left >= 18:
            label = "·"
        bbox = font.getbbox(label)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        tx = left + max(6, (right - left - tw) // 2)
        ty = int(TIER2_HEIGHT / 2 - th / 2 - bbox[1])
        text_fill = (255, 255, 255, 255) if frame >= start else rgba_mix(DARK_BASE, 0.58)
        stroke_fill = (0, 0, 0, 150) if frame >= start else (255, 255, 255, 120)
        td.text((tx, ty), label, fill=text_fill, font=font,
                stroke_width=1 if frame >= start else 0, stroke_fill=stroke_fill)
        segment_cursor += seg_w

    active_center_x = int(round(active_center_virtual - scroll))
    active_center_x = int(clamp(active_center_x, 70, VIDEO_W - 70))
    connector = ImageDraw.Draw(img)
    connector.line(
        [(active_center_x, bar_y + BAR_HEIGHT + 2), (active_center_x, sub_y - 4)],
        fill=(255, 255, 255, int(180 * entry_opacity)),
        width=3,
    )

    if entry_opacity < 1.0:
        alpha = tier2.split()[3]
        alpha = alpha.point(lambda p: int(p * entry_opacity))
        tier2.putalpha(alpha)
    img.alpha_composite(tier2, (TIER2_X, sub_y))
    return img


def render_video(visual_plan_path: str, output_path: str):
    with open(visual_plan_path, "r", encoding="utf-8") as f:
        plan = json.load(f)

    fps = plan.get("fps", FPS)
    total_frames = plan["totalFrames"]
    segments = plan["segments"]
    nodes = enrich_nodes_from_blueprint(plan["topicNodes"], Path(visual_plan_path))
    labels = load_progress_nav_labels(Path(visual_plan_path))
    if labels:
        label_nodes, label_segments = plan_from_progress_nav_labels(labels, fps, total_frames)
        if label_nodes and label_segments:
            nodes = label_nodes
            segments = label_segments

    print(f"  Progress bar renderer: {total_frames} frames @ {fps}fps")
    print(f"  Topics: {len(nodes)}, Segments: {len(segments)}")
    print(f"  Output: {output_path}")

    import time, threading

    t_start = time.perf_counter()

    # Start ffmpeg — send stderr to a log file to avoid pipe deadlock on Windows
    stderr_path = Path(output_path).with_suffix(".ffmpeg.log")
    stderr_f = open(stderr_path, "w")

    cmd = [
        "ffmpeg", "-y", "-hide_banner",
        "-f", "rawvideo",
        "-pix_fmt", "rgba",
        "-s", f"{VIDEO_W}x{VIDEO_H}",
        "-r", str(fps),
        "-i", "pipe:0",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-crf", "18",
        "-preset", "fast",
        "-movflags", "+faststart",
        output_path,
    ]

    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=stderr_f,
    )

    try:
        for frame_num in range(total_frames):
            frame_img = render_frame_tiered(frame_num, fps, segments, nodes)
            proc.stdin.write(frame_img.tobytes())

            if (frame_num + 1) % (fps * 10) == 0 or frame_num == total_frames - 1:
                pct = (frame_num + 1) / total_frames * 100
                elapsed = time.perf_counter() - t_start
                print(f"  [{frame_num + 1}/{total_frames}] {pct:.0f}%  ({elapsed:.1f}s)")
    except BrokenPipeError:
        pass

    proc.stdin.close()
    rc = proc.wait()
    stderr_f.close()

    if rc != 0:
        log_text = stderr_path.read_text(errors="replace")
        print(f"  [ERR] ffmpeg exit code {rc}:\n{log_text}", file=sys.stderr)
        stderr_path.unlink(missing_ok=True)
        sys.exit(1)

    stderr_path.unlink(missing_ok=True)
    t_total = time.perf_counter() - t_start
    file_size_mb = Path(output_path).stat().st_size / (1024 * 1024)
    print(f"  Done: {output_path} ({file_size_mb:.1f} MB, {t_total:.1f}s total)")


# ── CLI ───────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print("用法: python render_progress_bar.py <case_out_dir>")
        print("      python render_progress_bar.py <visual_plan.json> [-o output.mp4]")
        sys.exit(1)

    input_path = Path(sys.argv[1])

    # Parse optional -o flag
    output_path = None
    if "-o" in sys.argv:
        idx = sys.argv.index("-o")
        if idx + 1 < len(sys.argv):
            output_path = sys.argv[idx + 1]

    if input_path.is_dir():
        vp_path = input_path / "visual_plan.json"
        if not vp_path.exists():
            print(f"[ERR] {vp_path} not found", file=sys.stderr)
            sys.exit(1)
        if not output_path:
            output_path = str(input_path / "overlay_progress_bar.mp4")
        render_video(str(vp_path), output_path)
    elif input_path.is_file() and input_path.suffix == ".json":
        if not output_path:
            output_path = str(input_path.parent / "overlay_progress_bar.mp4")
        render_video(str(input_path), output_path)
    else:
        print(f"[ERR] Invalid input: {input_path}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
