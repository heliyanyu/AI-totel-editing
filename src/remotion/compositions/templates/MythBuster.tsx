/**
 * MythBuster — 误区翻转
 * 用途: ❌ 误区 → ✅ 正确认知
 *
 * 入场编排：误区逐条 slideUp → 箭头 scaleIn → 正确逐条 slideUp（揭示反转）
 */

import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import type { SceneProps } from "../../types";
import {
  TYPOGRAPHY, FONT_FAMILY, SAFE_AREA, SEMANTIC_COLORS,
  GLASS_CARD, tintBg, withAlpha,
} from "../../design-system";
import { slideUpIn, slideDownOut, fadeIn, mergeStyles, stagger } from "../../animations/index";
import { msToFrame } from "../../utils";

export const MythBuster: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enterMs = scene.timeline.enter_ms;
  const enterStart = msToFrame(scene.timeline.first_anchor_ms - enterMs, fps);
  const dwellEnd = msToFrame(scene.timeline.dwell_end_ms - enterMs, fps);

  const items = scene.items;
  const dosCount = (scene.template_props?.dosCount as number) ?? Math.ceil(items.length / 2);
  const myths = items.slice(0, dosCount);
  const truths = items.slice(dosCount);

  // ---- Title ----
  const titleEntry = slideUpIn(frame, enterStart, fps);
  const titleExit = slideDownOut(frame, dwellEnd, fps);
  const titleStyle = mergeStyles(titleEntry, titleExit);

  // ---- Myths: staggered slideUp, monotonic order ----
  const MIN_MYTH_GAP = 6;
  const mythDelays: number[] = [];
  for (let i = 0; i < dosCount; i++) {
    const item = items[i];
    let delay = item?.anchor_offset_ms !== undefined
      ? msToFrame(item.anchor_offset_ms, fps)
      : enterStart + stagger(i, 6);
    if (i > 0 && delay <= mythDelays[i - 1] + MIN_MYTH_GAP) {
      delay = mythDelays[i - 1] + MIN_MYTH_GAP;
    }
    mythDelays.push(delay);
  }

  const getMythStyle = (i: number) => {
    const delay = mythDelays[i] ?? enterStart;
    const entry = slideUpIn(frame, delay, fps, 35);
    const exit = slideDownOut(frame, dwellEnd, fps);
    return mergeStyles(entry, exit);
  };

  // ---- Arrow: appears AFTER all myths (based on actual last myth delay) ----
  const maxMythDelay = mythDelays.length > 0 ? Math.max(...mythDelays) : enterStart;
  const arrowDelay = maxMythDelay + 8;
  const arrowProgress = spring({
    frame: frame - arrowDelay,
    fps,
    config: { mass: 1, damping: 10, stiffness: 150 },
  });
  const arrowScale = interpolate(arrowProgress, [0, 1], [0.3, 1]);
  const arrowOpacity = interpolate(arrowProgress, [0, 0.3], [0, 1], { extrapolateRight: "clamp" });
  const arrowExit = slideDownOut(frame, dwellEnd, fps);

  // ---- Truths: appear after arrow, monotonic order ----
  const truthBaseDelay = arrowDelay + 6;
  const truthDelays: number[] = [];
  for (let i = 0; i < truths.length; i++) {
    const itemIdx = dosCount + i;
    const item = items[itemIdx];
    let delay = item?.anchor_offset_ms !== undefined
      ? Math.max(msToFrame(item.anchor_offset_ms, fps), truthBaseDelay)
      : truthBaseDelay + stagger(i, 6);
    if (i > 0 && delay <= truthDelays[i - 1] + MIN_MYTH_GAP) {
      delay = truthDelays[i - 1] + MIN_MYTH_GAP;
    }
    truthDelays.push(delay);
  }

  const getTruthStyle = (i: number) => {
    const delay = truthDelays[i] ?? truthBaseDelay;
    const entry = slideUpIn(frame, delay, fps, 35);
    const exit = slideDownOut(frame, dwellEnd, fps);
    return mergeStyles(entry, exit);
  };

  return (
    <AbsoluteFill
      style={{
        padding: `${SAFE_AREA.top}px ${SAFE_AREA.horizontal}px ${SAFE_AREA.bottom}px`,
        display: "flex",
        flexDirection: "column",
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
            textAlign: "center",
            marginBottom: 20,
            opacity: titleStyle.opacity,
            transform: titleStyle.transform,
            filter: titleStyle.filter,
          }}
        >
          {scene.title}
        </div>
      )}

      {/* 误区 */}
      {myths.map((item, i) => {
        const s = getMythStyle(i);
        return (
          <div
            key={`myth-${i}`}
            style={{
              ...GLASS_CARD,
              padding: "20px 24px",
              marginBottom: 12,
              background: tintBg(SEMANTIC_COLORS.negative, 0.04),
              border: `1px solid ${withAlpha(SEMANTIC_COLORS.negative, 0.12)}`,
              display: "flex",
              alignItems: "center",
              gap: 14,
              opacity: s.opacity,
              transform: s.transform,
              filter: s.filter,
            }}
          >
            <div style={{ fontSize: 36, flexShrink: 0 }}>❌</div>
            <div
              style={{
                fontSize: TYPOGRAPHY.body.fontSize - 8,
                color: "rgba(15, 23, 42, 0.4)",
                textDecoration: "line-through",
                fontFamily: FONT_FAMILY.sans,
                flex: 1,
              }}
            >
              {item.text}
            </div>
          </div>
        );
      })}

      {/* 箭头 — scalePop 弹入 */}
      <div
        style={{
          textAlign: "center",
          fontSize: 36,
          color: SEMANTIC_COLORS.brand,
          margin: "8px 0",
          opacity: arrowOpacity * arrowExit.opacity,
          transform: `scale(${arrowScale}) ${arrowExit.transform ?? ""}`.trim(),
        }}
      >
        ↓
      </div>

      {/* 正确 */}
      {truths.map((item, i) => {
        const s = getTruthStyle(i);
        return (
          <div
            key={`truth-${i}`}
            style={{
              ...GLASS_CARD,
              padding: "20px 24px",
              marginBottom: 12,
              background: tintBg(SEMANTIC_COLORS.positive, 0.04),
              border: `1px solid ${withAlpha(SEMANTIC_COLORS.positive, 0.12)}`,
              display: "flex",
              alignItems: "center",
              gap: 14,
              opacity: s.opacity,
              transform: s.transform,
              filter: s.filter,
            }}
          >
            <div style={{ fontSize: 36, flexShrink: 0 }}>✅</div>
            <div
              style={{
                fontSize: TYPOGRAPHY.body.fontSize - 8,
                fontWeight: 600,
                color: "rgba(15, 23, 42, 0.88)",
                fontFamily: FONT_FAMILY.sans,
                flex: 1,
              }}
            >
              {item.text}
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
