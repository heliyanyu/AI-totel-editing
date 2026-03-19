/**
 * BrickStack — 砖墙累积
 * 用途: 多因素汇聚 → 结果
 *
 * 入场编排：因素砖块逐个 slideUp → 大箭头 grow → 结果 scalePop 弹出
 */

import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import type { SceneProps } from "../../types";
import {
  TYPOGRAPHY, FONT_FAMILY, SAFE_AREA, SEMANTIC_COLORS, BORDER_RADIUS,
  withAlpha, tintBg,
} from "../../design-system";
import { slideUpIn, slideDownOut, mergeStyles, stagger } from "../../animations/index";
import { msToFrame } from "../../utils";
import { scalePop, pulse, pulseGlowShadow } from "../../animations/compose";

export const BrickStack: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enterMs = scene.timeline.enter_ms;
  const enterStart = msToFrame(scene.timeline.first_anchor_ms - enterMs, fps);
  const dwellEnd = msToFrame(scene.timeline.dwell_end_ms - enterMs, fps);

  const items = scene.items;
  const lastIdx = items.length - 1;
  const factors = items.slice(0, lastIdx);
  const result = items[lastIdx];

  // 按 2 列排布因素
  const rows: typeof factors[] = [];
  for (let i = 0; i < factors.length; i += 2) {
    rows.push(factors.slice(i, i + 2));
  }

  // ---- Factor delays: anchor-driven or stagger, monotonic order ----
  const MIN_FACTOR_GAP = 5; // minimum frames between consecutive factors
  const factorDelays: number[] = [];
  for (let i = 0; i < factors.length; i++) {
    const item = factors[i];
    let delay = item?.anchor_offset_ms !== undefined
      ? msToFrame(item.anchor_offset_ms, fps)
      : enterStart + stagger(i, 5);
    // Enforce monotonic order
    if (i > 0 && delay <= factorDelays[i - 1] + MIN_FACTOR_GAP) {
      delay = factorDelays[i - 1] + MIN_FACTOR_GAP;
    }
    factorDelays.push(delay);
  }

  const getFactorStyle = (idx: number) => {
    const delay = factorDelays[idx] ?? enterStart;
    const entry = slideUpIn(frame, delay, fps, 30);
    const exit = slideDownOut(frame, dwellEnd, fps);
    return mergeStyles(entry, exit);
  };

  // ---- Title ----
  const titleEntry = slideUpIn(frame, enterStart, fps);
  const titleExit = slideDownOut(frame, dwellEnd, fps);
  const titleStyle = mergeStyles(titleEntry, titleExit);

  // ---- Arrow: grows AFTER all factors (based on actual last factor delay) ----
  const maxFactorDelay = factorDelays.length > 0
    ? Math.max(...factorDelays)
    : enterStart;
  const arrowDelay = maxFactorDelay + 8;
  const arrowProgress = spring({
    frame: frame - arrowDelay,
    fps,
    config: { mass: 1, damping: 10, stiffness: 120 },
  });
  const arrowScaleY = interpolate(arrowProgress, [0, 1], [0, 1]);
  const arrowOpacity = interpolate(arrowProgress, [0, 0.3], [0, 1], { extrapolateRight: "clamp" });
  const arrowExit = slideDownOut(frame, dwellEnd, fps);

  // ---- Result: scalePop after arrow ----
  const resultDelay = arrowDelay + 8;
  const resultPop = scalePop(frame, resultDelay, fps, 1.12);
  const resultExit = slideDownOut(frame, dwellEnd, fps);

  // ---- Result dwell emphasis: pulse glow ----
  const isDwelling = frame > resultDelay + 15 && frame < dwellEnd;
  const resultGlow = isDwelling
    ? pulseGlowShadow(frame, fps, SEMANTIC_COLORS.negative, 1500, 20, 6)
    : undefined;
  const resultBreathScale = isDwelling ? 1 + pulse(frame, fps, 2000, 0.02) : 1;

  return (
    <AbsoluteFill
      style={{
        padding: `${SAFE_AREA.top}px ${SAFE_AREA.horizontal}px ${SAFE_AREA.bottom}px`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
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

      {/* 因素块 */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        {rows.map((row, ri) => (
          <div key={ri} style={{ display: "flex", gap: 14 }}>
            {row.map((item, ci) => {
              const idx = ri * 2 + ci;
              const s = getFactorStyle(idx);
              return (
                <div
                  key={(item.id ?? "") + idx}
                  style={{
                    padding: "16px 28px",
                    borderRadius: BORDER_RADIUS.sm + 2,
                    fontSize: TYPOGRAPHY.caption.fontSize + 6,
                    fontWeight: 500,
                    background: tintBg(SEMANTIC_COLORS.brand, 0.1),
                    color: "rgba(15, 23, 42, 0.7)",
                    border: `1px solid ${withAlpha(SEMANTIC_COLORS.brand, 0.15)}`,
                    fontFamily: FONT_FAMILY.sans,
                    opacity: s.opacity,
                    transform: s.transform,
                    filter: s.filter,
                  }}
                >
                  {item.emoji && <span style={{ marginRight: 6 }}>{item.emoji}</span>}
                  {item.text}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* 汇聚大箭头 — grow animation */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          margin: "24px 0",
          opacity: arrowOpacity * arrowExit.opacity,
          transform: `scaleY(${arrowScaleY}) ${arrowExit.transform ?? ""}`.trim(),
          transformOrigin: "top center",
        }}
      >
        <div
          style={{
            width: 5,
            height: 64,
            background: `linear-gradient(to bottom, ${withAlpha(SEMANTIC_COLORS.negative, 0.15)}, ${withAlpha(SEMANTIC_COLORS.negative, 0.5)})`,
          }}
        />
        <div style={{ fontSize: 48, color: withAlpha(SEMANTIC_COLORS.negative, 0.55), marginTop: -8 }}>
          ▼
        </div>
      </div>

      {/* 结果块 — scalePop 弹入 */}
      {result && (
        <div
          style={{
            padding: "36px 52px",
            borderRadius: BORDER_RADIUS.md,
            fontSize: TYPOGRAPHY.body.fontSize + 4,
            fontWeight: 700,
            background: tintBg(SEMANTIC_COLORS.negative, 0.08),
            color: SEMANTIC_COLORS.negative,
            border: `2px solid ${withAlpha(SEMANTIC_COLORS.negative, 0.25)}`,
            fontFamily: FONT_FAMILY.sans,
            textAlign: "center",
            opacity: resultPop.opacity * resultExit.opacity,
            transform: `${resultPop.transform ?? ""} scale(${resultBreathScale}) ${resultExit.transform ?? ""}`.trim(),
            boxShadow: resultGlow,
          }}
        >
          {result.emoji && <span style={{ marginRight: 10, fontSize: TYPOGRAPHY.body.fontSize + 12 }}>{result.emoji}</span>}
          {result.text}
        </div>
      )}
    </AbsoluteFill>
  );
};
