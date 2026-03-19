/**
 * 动画系统 — 基于 design-system.ts 的 3 个 spring 预设
 *
 * 入场 / 强调 / 退出 三类动画 + stagger 工具
 */

import { spring, interpolate } from "remotion";
import type { SpringConfig } from "remotion";
import {
  SPRING_PRESETS as DS_SPRING_PRESETS,
  ENTER_ANIMATION,
  EXIT_ANIMATION,
} from "../design-system";
import type { AnimationStyle } from "../types";

export type { AnimationStyle };

// ── Spring 预设 ──

export type SpringPresetName = "enter" | "emphasis" | "exit";

/** 新系统的 3 个核心 spring 预设 */
export const SPRINGS: Record<SpringPresetName, SpringConfig> = {
  enter: { ...DS_SPRING_PRESETS.enter, overshootClamping: false },
  emphasis: { ...DS_SPRING_PRESETS.emphasis, overshootClamping: false },
  exit: { ...DS_SPRING_PRESETS.exit, overshootClamping: false },
};

/**
 * 向后兼容的 SPRING_PRESETS（包含新旧名称）
 * NavigationMap 等已有组件使用 snappy/heavy/smooth 别名
 */
export const SPRING_PRESETS: Record<string, SpringConfig> = {
  ...SPRINGS,
  // 旧名 → 新名映射
  snappy: SPRINGS.emphasis,
  heavy: SPRINGS.enter,
  smooth: SPRINGS.exit,
};

function sp(
  frame: number,
  fps: number,
  preset: SpringPresetName,
  delay: number = 0,
  durationInFrames?: number,
): number {
  return spring({
    frame: frame - delay,
    fps,
    config: SPRINGS[preset],
    durationInFrames,
  });
}

// ── 入场动画 ──

/** 上滑 + 模糊渐入 + 微弹 */
export function slideUpIn(
  frame: number,
  startFrame: number,
  fps: number,
  distance: number = ENTER_ANIMATION.slideDistance,
): AnimationStyle {
  const f = frame - startFrame;
  const progress = sp(f, fps, "enter");
  const y = interpolate(progress, [0, 1], [distance, 0]);
  const opacity = interpolate(progress, [0, 1], [0, 1]);
  const blur = interpolate(progress, [0, 1], [ENTER_ANIMATION.blurStart, 0]);
  const scale = interpolate(progress, [0, 1], [0.96, 1]);
  return {
    opacity: Math.max(0, Math.min(1, opacity)),
    transform: `translateY(${y}px) scale(${scale})`,
    filter: blur > 0.1 ? `blur(${blur}px)` : undefined,
  };
}

/** 纯渐入（无位移） */
export function fadeIn(
  frame: number,
  startFrame: number,
  fps: number,
): AnimationStyle {
  const f = frame - startFrame;
  const progress = sp(f, fps, "enter");
  return { opacity: Math.max(0, Math.min(1, progress)) };
}

/** 缩放弹入 */
export function scalePopIn(
  frame: number,
  startFrame: number,
  fps: number,
): AnimationStyle {
  const f = frame - startFrame;
  const progress = sp(f, fps, "emphasis");
  const scale = interpolate(progress, [0, 1], [0.7, 1]);
  const opacity = interpolate(progress, [0, 1], [0, 1]);
  return {
    opacity: Math.max(0, Math.min(1, opacity)),
    transform: `scale(${scale})`,
  };
}

// ── 退出动画 ──

/** 下滑 + 渐隐 */
export function slideDownOut(
  frame: number,
  exitStartFrame: number,
  fps: number,
  distance: number = EXIT_ANIMATION.slideDistance,
): AnimationStyle {
  const f = frame - exitStartFrame;
  if (f < 0) return { opacity: 1 };
  const progress = sp(f, fps, "exit", 0, EXIT_ANIMATION.fadeFrames);
  const y = interpolate(progress, [0, 1], [0, distance]);
  const opacity = interpolate(progress, [0, 1], [1, 0]);
  return {
    opacity: Math.max(0, Math.min(1, opacity)),
    transform: `translateY(${y}px)`,
  };
}

/** 模糊渐隐 */
export function blurOut(
  frame: number,
  exitStartFrame: number,
  fps: number,
): AnimationStyle {
  const f = frame - exitStartFrame;
  if (f < 0) return { opacity: 1 };
  const progress = sp(f, fps, "exit", 0, EXIT_ANIMATION.fadeFrames);
  const opacity = interpolate(progress, [0, 1], [1, 0]);
  const blur = interpolate(progress, [0, 1], [0, 8]);
  return {
    opacity: Math.max(0, Math.min(1, opacity)),
    filter: blur > 0.1 ? `blur(${blur}px)` : undefined,
  };
}

// ── Stagger ──

/** 顺序延迟: 索引 × baseDelay 帧 */
export function stagger(index: number, baseDelay: number = 3): number {
  return index * baseDelay;
}

/** 反向延迟: 最后的先退 */
export function staggerReverse(
  index: number,
  total: number,
  baseDelay: number = 3,
): number {
  return (total - 1 - index) * baseDelay;
}

// ── 样式合并 ──

/** 合并入场 + 退出样式（opacity 相乘，transform 连接） */
export function mergeStyles(
  entry: AnimationStyle,
  exit: AnimationStyle,
): AnimationStyle {
  const transforms = [entry.transform, exit.transform].filter(Boolean).join(" ");
  const filters = [entry.filter, exit.filter].filter(Boolean).join(" ");
  return {
    opacity: entry.opacity * exit.opacity,
    transform: transforms || undefined,
    filter: filters || undefined,
  };
}

// ── 驻留微浮动 ──

/** 驻留期间的微浮动，防止画面完全静止 */
export function dwellFloat(
  frame: number,
  fps: number,
  itemIndex: number = 0,
): AnimationStyle {
  const periodFrames = (2400 / 1000) * fps;
  const phaseOffset = itemIndex * 0.4 * Math.PI;
  const phase = ((frame % periodFrames) / periodFrames) * Math.PI * 2 + phaseOffset;
  return {
    opacity: 0.95 + 0.05 * Math.sin(phase),
    transform: `translateY(${3 * Math.sin(phase)}px)`,
  };
}

// ══════════════════════════════════════════════════
// 向后兼容导出 — NavigationMap v3 等旧组件使用
// ══════════════════════════════════════════════════

type LegacyPresetName = "snappy" | "heavy" | "smooth";

/** 旧版 slideUp — 含 preset 参数 */
export function slideUp(
  frame: number,
  startFrame: number,
  fps: number,
  preset: LegacyPresetName | SpringPresetName = "enter",
  distance: number = ENTER_ANIMATION.slideDistance,
): AnimationStyle {
  const config = SPRING_PRESETS[preset] ?? SPRINGS.enter;
  const f = frame - startFrame;
  const progress = spring({ frame: f, fps, config });
  const y = interpolate(progress, [0, 1], [distance, 0]);
  const opacity = interpolate(progress, [0, 1], [0, 1]);
  return {
    opacity: Math.max(0, Math.min(1, opacity)),
    transform: `translateY(${y}px)`,
  };
}

/** 旧版 blurIn — 含 preset 参数 */
export function blurIn(
  frame: number,
  startFrame: number,
  fps: number,
  preset: LegacyPresetName | SpringPresetName = "enter",
): AnimationStyle {
  const config = SPRING_PRESETS[preset] ?? SPRINGS.enter;
  const f = frame - startFrame;
  const progress = spring({ frame: f, fps, config });
  const opacity = interpolate(progress, [0, 1], [0, 1]);
  const blur = interpolate(progress, [0, 1], [8, 0]);
  return {
    opacity: Math.max(0, Math.min(1, opacity)),
    filter: blur > 0.1 ? `blur(${blur}px)` : undefined,
  };
}

/** 旧版 getExitStyle — 等同于 slideDownOut */
export function getExitStyle(
  frame: number,
  exitStartFrame: number,
  fps: number,
): AnimationStyle {
  return slideDownOut(frame, exitStartFrame, fps);
}
