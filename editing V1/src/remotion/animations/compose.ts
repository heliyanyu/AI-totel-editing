/**
 * 复合动画工具
 * 提供多属性并行动画 + 脉冲呼吸效果
 */

import { spring, interpolate } from "remotion";
import type { SpringConfig } from "remotion";
import type { AnimationStyle } from "../types";
import { SPRINGS, type SpringPresetName } from "./index";

/** 单属性动画描述 */
interface AnimProp {
  from: number;
  to: number;
  preset?: SpringPresetName;
  config?: Partial<SpringConfig>;
  delay?: number;
  durationInFrames?: number;
}

/** 复合动画参数 */
interface ComposeParams {
  opacity?: AnimProp;
  translateX?: AnimProp;
  translateY?: AnimProp;
  scale?: AnimProp;
  rotate?: AnimProp;
  blur?: AnimProp;
}

/** 多属性并行动画 */
export function composeAnimation(
  frame: number,
  fps: number,
  params: ComposeParams,
): AnimationStyle {
  const transforms: string[] = [];
  let opacity = 1;
  let filter: string | undefined;

  const calcProp = (prop: AnimProp): number => {
    const config = prop.config
      ? { ...SPRINGS[prop.preset ?? "enter"], ...prop.config }
      : SPRINGS[prop.preset ?? "enter"];
    const progress = spring({
      frame: frame - (prop.delay ?? 0),
      fps,
      config,
      durationInFrames: prop.durationInFrames,
    });
    return interpolate(progress, [0, 1], [prop.from, prop.to]);
  };

  if (params.opacity) opacity = calcProp(params.opacity);
  if (params.translateX) transforms.push(`translateX(${calcProp(params.translateX)}px)`);
  if (params.translateY) transforms.push(`translateY(${calcProp(params.translateY)}px)`);
  if (params.scale) transforms.push(`scale(${calcProp(params.scale)})`);
  if (params.rotate) transforms.push(`rotate(${calcProp(params.rotate)}deg)`);
  if (params.blur) {
    const v = Math.max(0, calcProp(params.blur));
    if (v > 0.01) filter = `blur(${v}px)`;
  }

  return {
    opacity: Math.max(0, Math.min(1, opacity)),
    transform: transforms.length > 0 ? transforms.join(" ") : undefined,
    filter,
  };
}

/** 持续脉冲 (sin 波) */
export function pulse(
  frame: number,
  fps: number,
  periodMs: number = 1200,
  amplitude: number = 0.5,
): number {
  const periodFrames = (periodMs / 1000) * fps;
  const phase = (frame % periodFrames) / periodFrames;
  return amplitude * (0.5 + 0.5 * Math.sin(phase * Math.PI * 2 - Math.PI / 2));
}

// ══════════════════════════════════════════════════
// 强调动效 — 实现 design-system 的 8 种 EMPHASIS_TYPES
// ══════════════════════════════════════════════════

/**
 * ① scalePop — 弹性缩放 (通用金句、核心观点)
 * scale: 1 → scaleTarget → 1, with bouncy spring
 */
export function scalePop(
  frame: number,
  startFrame: number,
  fps: number,
  scaleTarget: number = 1.15,
): AnimationStyle {
  const f = frame - startFrame;
  if (f < 0) return { opacity: 0 };
  // Phase 1: scale from small → scaleTarget (bouncy pop-in)
  const progress = spring({
    frame: f,
    fps,
    config: { mass: 1, damping: 8, stiffness: 200 },
  });
  const s = interpolate(progress, [0, 1], [0.3, scaleTarget]);
  // Phase 2: settle from scaleTarget → 1.0
  const settleProgress = spring({
    frame: Math.max(0, f - 6),
    fps,
    config: { mass: 1, damping: 14, stiffness: 120 },
  });
  const settle = interpolate(settleProgress, [0, 1], [scaleTarget, 1]);
  const finalScale = f < 6 ? s : settle;
  // Opacity: quick fade-in during first few frames
  const opacity = interpolate(progress, [0, 0.4], [0, 1], { extrapolateRight: "clamp" });
  return {
    opacity,
    transform: `scale(${finalScale})`,
  };
}

/**
 * ⑤ shake — 警示抖动 (危害后果、误区警告)
 * Decaying horizontal oscillation
 */
export function shakeEmphasis(
  frame: number,
  startFrame: number,
  fps: number,
  amplitude: number = 6,
  oscillations: number = 4,
  durationMs: number = 350,
): AnimationStyle {
  const f = frame - startFrame;
  if (f < 0) return { opacity: 1 };
  const durationFrames = (durationMs / 1000) * fps;
  if (f >= durationFrames) return { opacity: 1 };
  const progress = f / durationFrames;
  const decay = 1 - progress;
  const x = amplitude * decay * Math.sin(progress * oscillations * Math.PI * 2);
  return {
    opacity: 1,
    transform: `translateX(${x}px)`,
  };
}

/**
 * ⑦ numBounce — 数字弹跳 (关键数值、百分比)
 * Bouncing Y + scale
 */
export function numBounce(
  frame: number,
  startFrame: number,
  fps: number,
  bounceHeight: number = 18,
  scaleTarget: number = 1.08,
): AnimationStyle {
  const f = frame - startFrame;
  if (f < 0) return { opacity: 0 };
  const progress = spring({
    frame: f,
    fps,
    config: { mass: 1, damping: 9, stiffness: 180 },
  });
  const y = interpolate(progress, [0, 0.5, 1], [-bounceHeight, bounceHeight * 0.3, 0]);
  const s = interpolate(progress, [0, 0.3, 1], [scaleTarget, scaleTarget * 1.02, 1]);
  // Opacity: quick fade-in during first few frames
  const opacity = interpolate(progress, [0, 0.4], [0, 1], { extrapolateRight: "clamp" });
  return {
    opacity,
    transform: `translateY(${y}px) scale(${s})`,
  };
}

/**
 * ⑧ gradientFlow — 渐变色流动背景 (正面结论)
 * Returns a CSS background-position offset for animated gradient
 */
export function gradientFlowOffset(
  frame: number,
  fps: number,
  durationMs: number = 2000,
): string {
  const periodFrames = (durationMs / 1000) * fps;
  const phase = (frame % periodFrames) / periodFrames;
  const x = Math.round(phase * 200);
  return `${x}% 50%`;
}

/**
 * ④ bgPop — 背景高亮弹出 (行动建议)
 * Returns opacity for background highlight
 */
export function bgPopOpacity(
  frame: number,
  startFrame: number,
  fps: number,
  durationMs: number = 400,
): number {
  const f = frame - startFrame;
  if (f < 0) return 0;
  const durationFrames = (durationMs / 1000) * fps;
  const progress = spring({
    frame: f,
    fps,
    config: { mass: 1, damping: 12, stiffness: 150 },
    durationInFrames: Math.round(durationFrames),
  });
  return interpolate(progress, [0, 1], [0, 1]);
}

/** 脉冲发光 boxShadow */
export function pulseGlowShadow(
  frame: number,
  fps: number,
  color: string,
  periodMs: number = 1200,
  maxSpread: number = 24,
  minSpread: number = 8,
): string {
  const p = pulse(frame, fps, periodMs);
  const spread = minSpread + (maxSpread - minSpread) * p;
  const alpha = 0.3 + 0.3 * p;
  const alphaHex = Math.round(alpha * 255).toString(16).padStart(2, "0");
  return `0 0 ${spread}px ${color}${alphaHex}, 0 4px 16px rgba(0,0,0,0.25)`;
}
