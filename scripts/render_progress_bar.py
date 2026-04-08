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
BAR_TOP = 78
BAR_HEIGHT = 88
CHIP_GAP = 10
CHIP_PADDING_H = 28
INDICATOR_W = 32
CONNECTOR_W = 18 + CHIP_GAP * 2
FONT_SIZE = 34
BORDER_RADIUS_MD = 18

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


# ── Chip Renderer ─────────────────────────────────────

def compute_chip_width(label: str, compact: bool) -> int:
    font_size = 28 if compact else FONT_SIZE
    font = get_font(font_size)
    text_w = measure_text_width(label, font)
    indicator_size = 26 if compact else 30
    gap = 6 if compact else 7
    pad_l = 12 if compact else 14
    pad_r = 16 if compact else 20
    return pad_l + indicator_size + gap + text_w + pad_r


def render_chip(img: Image.Image, x: int, y: int, label: str, index: int,
                state: str, tone_color: str, breathe_scale: float,
                compact: bool) -> int:
    """Render a chip at (x, y) and return its width."""
    font_size = 28 if compact else FONT_SIZE
    indicator_size = 26 if compact else 30
    gap = 6 if compact else 7
    pad_top = 10 if compact else 11
    pad_bottom = 10 if compact else 11
    pad_l = 12 if compact else 14
    pad_r = 16 if compact else 20
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
        draw_circle(cd, ind_cx, ind_cy, 4, fill=(255, 255, 255, 255))
    elif state == "completed":
        draw_checkmark(cd, ind_cx, ind_cy, size=indicator_size)
    else:
        # Number
        num_font = get_font(12)
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

    line_w = 14
    line_h = 2
    draw.rectangle(
        [x, y - line_h // 2, x + line_w, y + line_h // 2],
        fill=color,
    )


# ── Frame Renderer ────────────────────────────────────

def render_frame(frame: int, fps: int, segments: list[dict],
                 nodes: list[dict]) -> Image.Image:
    """Render a single progress bar frame (1080x1920 RGBA)."""
    img = Image.new("RGBA", (VIDEO_W, VIDEO_H), (0, 0, 0, 0))

    if not nodes or not segments:
        return img

    active_seg = get_active_segment(frame, segments)
    if not active_seg:
        return img

    node_states = get_node_states(active_seg["topicId"], nodes)
    tone_color = SCENE_TONE_SOLID.get(active_seg["tone"], SCENE_TONE_SOLID["brand"])

    # Entry animation (spring)
    entry = spring_value(frame, fps, mass=1.0, damping=16.0,
                         stiffness=100.0, duration_frames=24)
    translate_y = interpolate(entry, [0, 1], [-(BAR_HEIGHT + BAR_TOP), 0])
    entry_opacity = interpolate(entry, [0, 0.4, 1], [0, 0.5, 1])

    if entry_opacity < 0.01:
        return img

    # Breathing for active chip
    breathe_period = (1200 / 1000) * fps  # 36 frames
    breathe_phase = (frame % breathe_period) / breathe_period
    breathe_scale = 1 + 0.008 * math.sin(breathe_phase * math.pi * 2)

    # Calculate chip widths for scroll logic
    chip_widths = [compute_chip_width(n["label"], compact=False) for n in nodes]
    total_content_w = sum(chip_widths) + (len(nodes) - 1) * CONNECTOR_W
    needs_scroll = total_content_w > VIDEO_W - 32

    # Recalculate with compact if needed
    if needs_scroll:
        chip_widths = [compute_chip_width(n["label"], compact=True) for n in nodes]
        total_content_w = sum(chip_widths) + (len(nodes) - 1) * CONNECTOR_W

    active_idx = -1
    for i, node in enumerate(nodes):
        if node_states.get(node["id"]) == "active":
            active_idx = i
            break

    scroll_x = 0
    if needs_scroll and active_idx >= 0:
        center_x = sum(chip_widths[:active_idx]) + active_idx * CONNECTOR_W
        center_x += chip_widths[active_idx] / 2
        scroll_x = VIDEO_W / 2 - center_x
        max_scroll = 0
        min_scroll = VIDEO_W - total_content_w - 16
        scroll_x = max(min_scroll, min(max_scroll, scroll_x))

    # Create bar layer
    bar_img = Image.new("RGBA", (VIDEO_W, BAR_HEIGHT + 2), (0, 0, 0, 0))
    bar_draw = ImageDraw.Draw(bar_img)

    # Background: semi-transparent white
    bar_draw.rectangle([0, 0, VIDEO_W, BAR_HEIGHT],
                       fill=(255, 255, 255, 214))  # 0.84 * 255 ≈ 214
    # Bottom border
    bar_draw.line([0, BAR_HEIGHT, VIDEO_W, BAR_HEIGHT],
                  fill=rgba_mix(DARK_BASE, 0.08), width=1)

    # Draw chips and connectors
    if needs_scroll:
        start_x = 16 + int(scroll_x)
    else:
        start_x = (VIDEO_W - total_content_w) // 2

    cursor_x = start_x
    chip_center_y = BAR_HEIGHT // 2

    for idx, node in enumerate(nodes):
        state = node_states.get(node["id"], "pending")

        # Connector before chip (except first)
        if idx > 0:
            prev_state = node_states.get(nodes[idx - 1]["id"], "pending")
            connector_x = cursor_x
            render_connector(bar_draw, connector_x + CHIP_GAP,
                             chip_center_y, prev_state)
            cursor_x += CONNECTOR_W

        # Chip
        chip_h_approx = 50 if not needs_scroll else 44
        chip_y = chip_center_y - chip_h_approx // 2
        this_breathe = breathe_scale if state == "active" else 1.0

        # Render chip onto bar_img
        chip_w = render_chip(bar_img, cursor_x, chip_y,
                             node["label"], idx, state, tone_color,
                             this_breathe, needs_scroll)
        cursor_x += chip_w

    # Apply entry animation: translate Y + opacity
    bar_y = int(BAR_TOP + translate_y)

    if entry_opacity < 1.0:
        # Apply opacity to the entire bar layer
        alpha = bar_img.split()[3]
        alpha = alpha.point(lambda p: int(p * entry_opacity))
        bar_img.putalpha(alpha)

    img.alpha_composite(bar_img, (0, bar_y))
    return img


# ── Video Encoding ────────────────────────────────────

def render_video(visual_plan_path: str, output_path: str):
    with open(visual_plan_path, "r", encoding="utf-8") as f:
        plan = json.load(f)

    fps = plan.get("fps", FPS)
    total_frames = plan["totalFrames"]
    segments = plan["segments"]
    nodes = plan["topicNodes"]

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
            frame_img = render_frame(frame_num, fps, segments, nodes)
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
