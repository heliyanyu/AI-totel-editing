"""
Python Navigation Map Renderer — 替代 Remotion 渲染 overlay_navigation.mp4

读取 visual_plan.json，用 Pillow 逐帧绘制导览图，通过 ffmpeg 编码为 H.264 MP4。
导览图在每个 topic 切换时出现，显示所有 topic 的进度状态，几秒后淡出。

用法:
  python scripts/render_navigation.py <case_out_dir>
  python scripts/render_navigation.py path/to/visual_plan.json -o output.mp4
"""

import json
import math
import subprocess
import sys
import time
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

# ── Canvas ────────────────────────────────────────────
VIDEO_W = 1080
VIDEO_H = 1920
FPS = 30

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

# ── Navigation Layout ─────────────────────────────────
BG_COLOR = (246, 250, 255, 255)         # rgba(246, 250, 255, 1) opaque
PANEL_WIDTH_RATIO = 0.80
PANEL_MAX_WIDTH = 800
PANEL_PADDING = 60

TITLE_TEXT = "内容导览"
TITLE_FONT_SIZE = 52                     # TYPOGRAPHY.body.fontSize(58) - 6
TITLE_MARGIN_BOTTOM = 32
TITLE_LETTER_SPACING = 3

CARD_BORDER_RADIUS = 16
CARD_PADDING_V = 20
CARD_PADDING_H = 28
CARD_GAP = 16                            # gap between indicator and label
CARD_SHADOW_OFFSET = 4
CARD_SHADOW_BLUR = 8

INDICATOR_SIZE = 36
INDICATOR_FONT_SIZE = 18

LABEL_FONT_SIZE = 48                     # TYPOGRAPHY.body.fontSize(58) - 10

CONNECTOR_W = 4
CONNECTOR_H = 24


def hex_to_rgba(hex_color: str, alpha: float = 1.0) -> tuple[int, int, int, int]:
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return (r, g, b, int(alpha * 255))


def rgba_mix(hex_color: str, alpha: float) -> tuple[int, int, int, int]:
    return hex_to_rgba(hex_color, alpha)


# ── Font Loading ──────────────────────────────────────

_font_cache: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}

FONT_CANDIDATES = [
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/NotoSansSC-Regular.otf",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
]
FONT_BOLD_CANDIDATES = [
    "C:/Windows/Fonts/msyhbd.ttc",
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
        fallback = _resolve_font_path(FONT_BOLD_CANDIDATES if not bold else FONT_CANDIDATES)
        path = fallback or ""

    font = ImageFont.truetype(path, size) if path else ImageFont.load_default()
    _font_cache[key] = font
    return font


def measure_text_width(text: str, font: ImageFont.FreeTypeFont) -> int:
    bbox = font.getbbox(text)
    return bbox[2] - bbox[0]


def measure_text_height(text: str, font: ImageFont.FreeTypeFont) -> int:
    bbox = font.getbbox(text)
    return bbox[3] - bbox[1]


# ── Drawing Helpers ───────────────────────────────────

def draw_circle(draw: ImageDraw.ImageDraw, cx: int, cy: int, r: int,
                fill: tuple | None = None):
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)


def draw_checkmark(draw: ImageDraw.ImageDraw, cx: int, cy: int, size: int = 22):
    s = size / 24.0
    ox = cx - size // 2
    oy = cy - size // 2
    points = [
        (ox + 6 * s, oy + 13 * s),
        (ox + 10.5 * s, oy + 17.5 * s),
        (ox + 18 * s, oy + 8 * s),
    ]
    draw.line(points, fill=(255, 255, 255, 255), width=max(2, int(2.5 * s)))


def draw_text_with_spacing(draw: ImageDraw.ImageDraw, x: int, y: int,
                           text: str, font: ImageFont.FreeTypeFont,
                           fill: tuple, spacing: int = 0):
    """Draw text with letter spacing."""
    if spacing <= 0:
        draw.text((x, y), text, fill=fill, font=font)
        return
    cursor = x
    for ch in text:
        draw.text((cursor, y), ch, fill=fill, font=font)
        bbox = font.getbbox(ch)
        cursor += (bbox[2] - bbox[0]) + spacing


# ── Card Shadow ───────────────────────────────────────

def draw_card_with_shadow(img: Image.Image, x: int, y: int, w: int, h: int,
                          fill: tuple, border_color: tuple | None = None,
                          border_width: int = 1,
                          left_accent: tuple | None = None,
                          left_accent_width: int = 5,
                          glow_color: tuple | None = None,
                          radius: int = CARD_BORDER_RADIUS):
    """Draw a card with subtle shadow and optional left accent border."""
    # Shadow layer
    shadow_img = Image.new("RGBA", (w + 16, h + 16), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow_img)
    sd.rounded_rectangle(
        [8, 8, w + 8, h + 8],
        radius=radius,
        fill=(0, 0, 0, 20),
    )
    shadow_img = shadow_img.filter(ImageFilter.GaussianBlur(radius=4))
    img.alpha_composite(shadow_img, (x - 8, y - 4))

    # Glow for active card
    if glow_color:
        glow_img = Image.new("RGBA", (w + 32, h + 32), (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow_img)
        gd.rounded_rectangle(
            [16, 16, w + 16, h + 16],
            radius=radius,
            fill=glow_color,
        )
        glow_img = glow_img.filter(ImageFilter.GaussianBlur(radius=8))
        img.alpha_composite(glow_img, (x - 16, y - 16))

    # Card body
    card_img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    cd = ImageDraw.Draw(card_img)
    cd.rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, fill=fill,
                         outline=border_color, width=border_width)

    # Left accent border (for completed cards)
    if left_accent:
        cd.rounded_rectangle(
            [0, 0, left_accent_width, h - 1],
            radius=min(radius, left_accent_width),
            fill=left_accent,
        )

    img.alpha_composite(card_img, (x, y))


# ── Navigation Frame Renderer ─────────────────────────

def render_nav_frame(appearance: dict, nodes: list[dict],
                     local_frame: int, fps: int) -> Image.Image:
    """Render a single navigation map frame."""
    img = Image.new("RGBA", (VIDEO_W, VIDEO_H), (0, 0, 0, 0))

    total_frames = max(1, appearance["endFrame"] - appearance["startFrame"])
    tone_color = SCENE_TONE_SOLID.get(appearance["tone"], SCENE_TONE_SOLID["brand"])
    active_node_id = appearance["activeNode"]
    completed_ids = set(appearance.get("completedNodes", []))

    # Exit fade
    fade_frames = min(round(0.2 * fps), total_frames)
    fade_start = total_frames - fade_frames
    if local_frame >= fade_start:
        opacity = max(0.0, 1.0 - (local_frame - fade_start) / fade_frames)
    else:
        opacity = 1.0

    if opacity < 0.01:
        return img

    # Build on a separate layer for opacity
    layer = Image.new("RGBA", (VIDEO_W, VIDEO_H), BG_COLOR)
    draw = ImageDraw.Draw(layer)

    # Panel dimensions
    panel_w = min(int(VIDEO_W * PANEL_WIDTH_RATIO), PANEL_MAX_WIDTH)
    panel_x = (VIDEO_W - panel_w) // 2

    # Calculate total content height to center vertically
    card_h = CARD_PADDING_V * 2 + max(INDICATOR_SIZE, LABEL_FONT_SIZE + 4)
    total_h = (TITLE_FONT_SIZE + TITLE_MARGIN_BOTTOM +
               len(nodes) * card_h +
               (len(nodes) - 1) * CONNECTOR_H)
    start_y = max(PANEL_PADDING, (VIDEO_H - total_h) // 2)

    # Title "内容导览"
    title_font = get_font(TITLE_FONT_SIZE)
    title_color = rgba_mix(DARK_BASE, 0.5)
    title_w = measure_text_width(TITLE_TEXT, title_font) + TITLE_LETTER_SPACING * (len(TITLE_TEXT) - 1)
    title_x = (VIDEO_W - title_w) // 2
    title_bbox = title_font.getbbox(TITLE_TEXT)
    title_y = start_y
    draw_text_with_spacing(draw, title_x, title_y, TITLE_TEXT, title_font,
                           fill=title_color, spacing=TITLE_LETTER_SPACING)

    cursor_y = title_y + TITLE_FONT_SIZE + TITLE_MARGIN_BOTTOM

    # Draw nodes
    for idx, node in enumerate(nodes):
        is_active = node["id"] == active_node_id
        is_completed = node["id"] in completed_ids
        is_pending = not is_active and not is_completed

        # Card styling
        if is_active:
            card_fill = hex_to_rgba(tone_color)
            card_border = hex_to_rgba(tone_color)
            glow = hex_to_rgba(tone_color, 0.35)
            left_accent = None
            indicator_bg = hex_to_rgba(tone_color)
            label_color = (255, 255, 255, 255)
            label_bold = True
        elif is_completed:
            card_fill = (255, 255, 255, 245)
            card_border = rgba_mix(DARK_BASE, 0.1)
            glow = None
            left_accent = hex_to_rgba(POSITIVE_COLOR)
            indicator_bg = hex_to_rgba(POSITIVE_COLOR)
            label_color = rgba_mix(DARK_BASE, 0.88)
            label_bold = False
        else:  # pending
            card_fill = (255, 255, 255, 230)
            card_border = rgba_mix(DARK_BASE, 0.1)
            glow = None
            left_accent = None
            indicator_bg = rgba_mix(DARK_BASE, 0.15)
            label_color = rgba_mix(DARK_BASE, 0.65)
            label_bold = False

        # Pending dimming
        pending_dim = 0.6 if is_pending else 1.0

        # Draw card
        draw_card_with_shadow(
            layer, panel_x, cursor_y, panel_w, card_h,
            fill=card_fill, border_color=card_border,
            left_accent=left_accent, glow_color=glow,
        )

        # Indicator circle
        ind_cx = panel_x + CARD_PADDING_H + INDICATOR_SIZE // 2
        ind_cy = cursor_y + card_h // 2
        card_draw = ImageDraw.Draw(layer)
        draw_circle(card_draw, ind_cx, ind_cy, INDICATOR_SIZE // 2, fill=indicator_bg)

        # Indicator content
        if is_completed:
            draw_checkmark(card_draw, ind_cx, ind_cy, size=22)
        elif is_active:
            # White filled dot "●"
            ind_font = get_font(INDICATOR_FONT_SIZE, bold=True)
            dot = "●"
            dw = measure_text_width(dot, ind_font)
            db = ind_font.getbbox(dot)
            dh = db[3] - db[1]
            card_draw.text((ind_cx - dw // 2, ind_cy - dh // 2 - db[1]),
                           dot, fill=(255, 255, 255, 255), font=ind_font)
        else:
            # Number
            ind_font = get_font(INDICATOR_FONT_SIZE, bold=True)
            num = str(idx + 1)
            nw = measure_text_width(num, ind_font)
            nb = ind_font.getbbox(num)
            nh = nb[3] - nb[1]
            card_draw.text((ind_cx - nw // 2, ind_cy - nh // 2 - nb[1]),
                           num, fill=(255, 255, 255, 255), font=ind_font)

        # Label
        label_font = get_font(LABEL_FONT_SIZE, bold=label_bold)
        label_x = ind_cx + INDICATOR_SIZE // 2 + CARD_GAP
        label_bbox = label_font.getbbox(node["label"])
        label_h = label_bbox[3] - label_bbox[1]
        label_y = ind_cy - label_h // 2 - label_bbox[1]

        # Apply pending dimming to label alpha
        final_label_color = (
            label_color[0], label_color[1], label_color[2],
            int(label_color[3] * pending_dim)
        )
        card_draw.text((label_x, label_y), node["label"],
                       fill=final_label_color, font=label_font)

        cursor_y += card_h

        # Connector line (between cards, not after last)
        if idx < len(nodes) - 1:
            conn_color = (hex_to_rgba(POSITIVE_COLOR) if is_completed
                          else rgba_mix(DARK_BASE, 0.15))
            conn_x = (VIDEO_W - CONNECTOR_W) // 2
            card_draw.rounded_rectangle(
                [conn_x, cursor_y, conn_x + CONNECTOR_W, cursor_y + CONNECTOR_H],
                radius=2, fill=conn_color,
            )
            cursor_y += CONNECTOR_H

    # Apply global opacity for exit fade
    if opacity < 1.0:
        alpha = layer.split()[3]
        alpha = alpha.point(lambda p: int(p * opacity))
        layer.putalpha(alpha)

    img.alpha_composite(layer)
    return img


# ── Video Encoding ────────────────────────────────────

def render_video(visual_plan_path: str, output_path: str):
    with open(visual_plan_path, "r", encoding="utf-8") as f:
        plan = json.load(f)

    fps = plan.get("fps", FPS)
    total_frames = plan["totalFrames"]
    nodes = plan["topicNodes"]
    appearances = plan.get("topicAppearances", [])

    print(f"  Navigation renderer: {total_frames} frames @ {fps}fps")
    print(f"  Topics: {len(nodes)}, Appearances: {len(appearances)}")
    print(f"  Output: {output_path}")

    if not appearances:
        print("  [WARN] No navigation appearances, nothing to render")
        return

    t_start = time.perf_counter()

    # Output one clip per appearance, plus a manifest JSON
    out_dir = Path(output_path).parent
    out_dir.mkdir(parents=True, exist_ok=True)
    out_stem = Path(output_path).stem  # e.g. "overlay_navigation"
    manifest: list[dict] = []

    for app_idx, app in enumerate(appearances):
        clip_frames = app["endFrame"] - app["startFrame"]
        clip_name = f"{out_stem}_{app_idx + 1:03d}.mp4"
        clip_path = str(out_dir / clip_name)
        start_sec = app["startFrame"] / fps

        print(f"  [{app_idx + 1}/{len(appearances)}] {clip_name}: "
              f"frames {app['startFrame']}-{app['endFrame']} "
              f"({clip_frames} frames, {start_sec:.2f}s)")

        # Start ffmpeg for this clip
        stderr_path = Path(clip_path).with_suffix(".ffmpeg.log")
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
            clip_path,
        ]

        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=stderr_f,
        )

        try:
            for local_frame in range(clip_frames):
                frame_img = render_nav_frame(app, nodes, local_frame, fps)
                proc.stdin.write(frame_img.tobytes())
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
        clip_size = Path(clip_path).stat().st_size
        print(f"    → {clip_path} ({clip_size / 1024:.0f} KB)")

        manifest.append({
            "file": clip_name,
            "startFrame": app["startFrame"],
            "endFrame": app["endFrame"],
            "startSec": round(start_sec, 3),
            "durationSec": round(clip_frames / fps, 3),
            "activeNode": app["activeNode"],
            "tone": app["tone"],
        })

    # Write manifest
    manifest_path = str(out_dir / f"{out_stem}_manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as mf:
        json.dump(manifest, mf, ensure_ascii=False, indent=2)

    t_total = time.perf_counter() - t_start
    print(f"  Done: {len(manifest)} clips + manifest ({t_total:.1f}s total)")
    print(f"  Manifest: {manifest_path}")


# ── CLI ───────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print("用法: python render_navigation.py <case_out_dir>")
        print("      python render_navigation.py <visual_plan.json> [-o output.mp4]")
        sys.exit(1)

    input_path = Path(sys.argv[1])
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
            output_path = str(input_path / "nav_scenes" / "overlay_navigation.mp4")
        render_video(str(vp_path), output_path)
    elif input_path.is_file() and input_path.suffix == ".json":
        if not output_path:
            output_path = str(input_path.parent / "overlay_navigation.mp4")
        render_video(str(input_path), output_path)
    else:
        print(f"[ERR] Invalid input: {input_path}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
