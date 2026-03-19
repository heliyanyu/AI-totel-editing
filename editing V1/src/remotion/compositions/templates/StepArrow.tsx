/**
 * StepArrow — 逐步点亮因果链
 * 用途: 因→果流程、行为→后果
 *
 * 入场编排：每个步骤 slideUp → 箭头 grow → 下一步骤 slideUp → ...
 * 最后一步（结果）用 scalePop 强调
 */

import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import type { SceneProps } from "../../types";
import {
  TYPOGRAPHY, FONT_FAMILY, SAFE_AREA, SEMANTIC_COLORS,
  GLASS_CARD, categoryColor, tintBg, withAlpha,
} from "../../design-system";
import { slideUpIn, slideDownOut, mergeStyles, stagger } from "../../animations/index";
import { msToFrame } from "../../utils";
import { scalePop, pulseGlowShadow, pulse } from "../../animations/compose";

export const StepArrow: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enterMs = scene.timeline.enter_ms;
  const enterStart = msToFrame(scene.timeline.first_anchor_ms - enterMs, fps);
  const dwellEnd = msToFrame(scene.timeline.dwell_end_ms - enterMs, fps);

  const items = scene.items;
  const lastIdx = items.length - 1;

  // ---- Title ----
  const titleEntry = slideUpIn(frame, enterStart, fps);
  const titleExit = slideDownOut(frame, dwellEnd, fps);
  const titleStyle = mergeStyles(titleEntry, titleExit);

  // Each step has: item slideUp → arrow grow → next item
  // MUST enforce monotonic order: each step delay > previous + MIN_GAP
  const STEP_DELAY = 8;
  const MIN_STEP_GAP = 6; // minimum frames between consecutive steps

  // Pre-compute all delays, enforcing monotonic increasing order
  const stepDelays: number[] = [];
  for (let i = 0; i <= lastIdx; i++) {
    const item = items[i];
    let delay = item?.anchor_offset_ms !== undefined
      ? msToFrame(item.anchor_offset_ms, fps)
      : enterStart + i * STEP_DELAY;
    // Enforce: each step appears after the previous one
    if (i > 0 && delay <= stepDelays[i - 1] + MIN_STEP_GAP) {
      delay = stepDelays[i - 1] + MIN_STEP_GAP;
    }
    stepDelays.push(delay);
  }

  const getStepDelay = (i: number): number => stepDelays[i] ?? enterStart;

  // ---- Last item dwell emphasis ----
  const lastDelay = getStepDelay(lastIdx);
  const lastIsDwelling = frame > lastDelay + 15 && frame < dwellEnd;
  const lastGlow = lastIsDwelling
    ? pulseGlowShadow(frame, fps, SEMANTIC_COLORS.negative, 1500, 16, 4)
    : undefined;
  const lastBreathScale = lastIsDwelling ? 1 + pulse(frame, fps, 2000, 0.02) : 1;

  const getItemStyle = (i: number) => {
    const isLast = i === lastIdx;
    const delay = getStepDelay(i);

    if (isLast) {
      // Last item: scalePop entrance + dwell glow
      const pop = scalePop(frame, delay, fps, 1.08);
      const exit = slideDownOut(frame, dwellEnd, fps);
      return {
        opacity: pop.opacity * exit.opacity,
        transform: `${pop.transform ?? ""} scale(${lastBreathScale}) ${exit.transform ?? ""}`.trim(),
        filter: exit.filter,
      };
    }

    const entry = slideUpIn(frame, delay, fps, 35);
    const exit = slideDownOut(frame, dwellEnd, fps);
    return mergeStyles(entry, exit);
  };

  // Arrow appears midway between its preceding item and the next item
  const getArrowStyle = (i: number) => {
    const itemDelay = getStepDelay(i);
    const arrowDelay = itemDelay + 4; // 4 frames after item starts
    const progress = spring({
      frame: frame - arrowDelay,
      fps,
      config: { mass: 1, damping: 12, stiffness: 140 },
    });
    const scaleY = interpolate(progress, [0, 1], [0, 1]);
    const opacity = interpolate(progress, [0, 0.3], [0, 1], { extrapolateRight: "clamp" });
    const exit = slideDownOut(frame, dwellEnd, fps);
    return {
      opacity: opacity * exit.opacity,
      transform: `scaleY(${scaleY}) ${exit.transform ?? ""}`.trim(),
      transformOrigin: "top center" as const,
    };
  };

  return (
    <AbsoluteFill
      style={{
        padding: `${SAFE_AREA.top}px ${SAFE_AREA.horizontal}px ${SAFE_AREA.bottom}px`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
        gap: 0,
      }}
    >
      {scene.title && (
        <div
          style={{
            fontSize: TYPOGRAPHY.body.fontSize,
            fontWeight: 600,
            color: "rgba(15, 23, 42, 0.88)",
            fontFamily: FONT_FAMILY.sans,
            marginBottom: 20,
            opacity: titleStyle.opacity,
            transform: titleStyle.transform,
            filter: titleStyle.filter,
          }}
        >
          {scene.title}
        </div>
      )}

      {items.map((item, i) => {
        const isLast = i === lastIdx;
        const color = isLast ? SEMANTIC_COLORS.negative : categoryColor(i);
        const itemStyle = getItemStyle(i);
        return (
          <React.Fragment key={(item.id ?? "") + i}>
            <div
              style={{
                ...GLASS_CARD,
                padding: "20px 28px",
                textAlign: "center",
                borderLeft: `5px solid ${color}`,
                width: "100%",
                ...(isLast ? { background: tintBg(SEMANTIC_COLORS.negative, 0.05) } : {}),
                opacity: itemStyle.opacity,
                transform: itemStyle.transform,
                filter: itemStyle.filter,
                ...(isLast && lastGlow ? { boxShadow: lastGlow } : {}),
              }}
            >
              <div
                style={{
                  fontSize: TYPOGRAPHY.body.fontSize,
                  fontWeight: isLast ? 700 : TYPOGRAPHY.body.fontWeight,
                  color: isLast ? SEMANTIC_COLORS.negative : "rgba(15, 23, 42, 0.88)",
                  fontFamily: FONT_FAMILY.sans,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                }}
              >
                {item.emoji && <span style={{ fontSize: TYPOGRAPHY.body.fontSize + 4 }}>{item.emoji}</span>}
                <span>{item.text}</span>
              </div>
            </div>
            {/* 箭头连接线 — grow animation */}
            {!isLast && (() => {
              const arrowStyle = getArrowStyle(i);
              return (
                <div
                  style={{
                    width: 4,
                    height: 48,
                    margin: "6px auto",
                    background: `linear-gradient(to bottom, ${withAlpha(SEMANTIC_COLORS.brand, 0.35)}, ${withAlpha(SEMANTIC_COLORS.brand, 0.12)})`,
                    position: "relative",
                    opacity: arrowStyle.opacity,
                    transform: arrowStyle.transform,
                    transformOrigin: arrowStyle.transformOrigin,
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      bottom: -18,
                      left: "50%",
                      transform: "translateX(-50%)",
                      fontSize: 24,
                      color: withAlpha(SEMANTIC_COLORS.brand, 0.45),
                    }}
                  >
                    ▼
                  </div>
                </div>
              );
            })()}
          </React.Fragment>
        );
      })}
    </AbsoluteFill>
  );
};
