/**
 * BranchPath — 双路径分叉
 * 用途: 对立结果（及时就医 vs 拖延恶化）
 *
 * 入场编排：条件 slideUp → 分叉符号 scaleIn → 左分支 slideLeft → 右分支 slideRight
 */

import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import type { SceneProps } from "../../types";
import {
  TYPOGRAPHY, FONT_FAMILY, SAFE_AREA, SEMANTIC_COLORS,
  GLASS_CARD, withAlpha,
} from "../../design-system";
import { slideUpIn, slideDownOut, mergeStyles } from "../../animations/index";
import { msToFrame } from "../../utils";
import { pulseGlowShadow } from "../../animations/compose";

export const BranchPath: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enterMs = scene.timeline.enter_ms;
  const enterStart = msToFrame(scene.timeline.first_anchor_ms - enterMs, fps);
  const dwellEnd = msToFrame(scene.timeline.dwell_end_ms - enterMs, fps);

  const items = scene.items;
  const condition = items[0];
  const leftBranch = items[1]; // positive
  const rightBranch = items[2]; // negative

  // ---- Condition: slideUp entrance ----
  const condEntry = slideUpIn(frame, enterStart, fps, 40);
  const condExit = slideDownOut(frame, dwellEnd, fps);
  const condStyle = mergeStyles(condEntry, condExit);

  // ---- Fork symbol: delayed scaleIn (8 frames) ----
  const forkDelay = enterStart + 8;
  const forkProgress = spring({
    frame: frame - forkDelay,
    fps,
    config: { mass: 1, damping: 10, stiffness: 160 },
  });
  const forkScale = interpolate(forkProgress, [0, 1], [0.3, 1]);
  const forkOpacity = interpolate(forkProgress, [0, 0.3], [0, 1], { extrapolateRight: "clamp" });
  const forkExit = slideDownOut(frame, dwellEnd, fps);

  // ---- Left branch: delayed slideIn from left (14 frames) ----
  const leftDelay = enterStart + 14;
  const leftProgress = spring({
    frame: frame - leftDelay,
    fps,
    config: { mass: 1, damping: 12, stiffness: 140 },
  });
  const leftX = interpolate(leftProgress, [0, 1], [-60, 0]);
  const leftOpacity = interpolate(leftProgress, [0, 1], [0, 1]);
  const leftExit = slideDownOut(frame, dwellEnd, fps);

  // ---- Right branch: delayed slideIn from right (18 frames) ----
  const rightDelay = enterStart + 18;
  const rightProgress = spring({
    frame: frame - rightDelay,
    fps,
    config: { mass: 1, damping: 12, stiffness: 140 },
  });
  const rightX = interpolate(rightProgress, [0, 1], [60, 0]);
  const rightOpacity = interpolate(rightProgress, [0, 1], [0, 1]);
  const rightExit = slideDownOut(frame, dwellEnd, fps);

  // ---- Dwell emphasis: glow on branches ----
  const isDwelling = frame > rightDelay + 15 && frame < dwellEnd;
  const leftGlow = isDwelling
    ? pulseGlowShadow(frame, fps, SEMANTIC_COLORS.positive, 1800, 14, 4)
    : undefined;
  const rightGlow = isDwelling
    ? pulseGlowShadow(frame, fps, SEMANTIC_COLORS.negative, 1800, 14, 4)
    : undefined;

  return (
    <AbsoluteFill
      style={{
        padding: `${SAFE_AREA.top}px ${SAFE_AREA.horizontal}px ${SAFE_AREA.bottom}px`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* 条件节点 */}
      {condition && (
        <div
          style={{
            ...GLASS_CARD,
            padding: "20px 28px",
            textAlign: "center",
            borderLeft: `5px solid ${SEMANTIC_COLORS.brand}`,
            width: "100%",
            marginBottom: 12,
            opacity: condStyle.opacity,
            transform: condStyle.transform,
            filter: condStyle.filter,
          }}
        >
          <div
            style={{
              fontSize: TYPOGRAPHY.body.fontSize,
              fontWeight: TYPOGRAPHY.body.fontWeight,
              color: "rgba(15, 23, 42, 0.88)",
              fontFamily: FONT_FAMILY.sans,
            }}
          >
            {condition.text}
          </div>
        </div>
      )}

      {/* 分叉符号 */}
      <div
        style={{
          fontSize: 28,
          color: withAlpha(SEMANTIC_COLORS.brand, 0.5),
          marginBottom: 8,
          opacity: forkOpacity * forkExit.opacity,
          transform: `scale(${forkScale}) ${forkExit.transform ?? ""}`.trim(),
        }}
      >
        ↙ ↘
      </div>

      {/* 双路径 */}
      <div style={{ display: "flex", gap: 14, width: "100%" }}>
        {leftBranch && (
          <div
            style={{
              ...GLASS_CARD,
              flex: 1,
              padding: "20px",
              borderLeft: `5px solid ${SEMANTIC_COLORS.positive}`,
              textAlign: "center",
              opacity: leftOpacity * leftExit.opacity,
              transform: `translateX(${leftX}px) ${leftExit.transform ?? ""}`.trim(),
              boxShadow: leftGlow,
            }}
          >
            <div
              style={{
                fontSize: TYPOGRAPHY.body.fontSize - 8,
                fontWeight: 600,
                color: SEMANTIC_COLORS.positive,
                fontFamily: FONT_FAMILY.sans,
              }}
            >
              {leftBranch.text} ✅
            </div>
          </div>
        )}
        {rightBranch && (
          <div
            style={{
              ...GLASS_CARD,
              flex: 1,
              padding: "20px",
              borderLeft: `5px solid ${SEMANTIC_COLORS.negative}`,
              textAlign: "center",
              opacity: rightOpacity * rightExit.opacity,
              transform: `translateX(${rightX}px) ${rightExit.transform ?? ""}`.trim(),
              boxShadow: rightGlow,
            }}
          >
            <div
              style={{
                fontSize: TYPOGRAPHY.body.fontSize - 8,
                fontWeight: 600,
                color: SEMANTIC_COLORS.negative,
                fontFamily: FONT_FAMILY.sans,
              }}
            >
              {rightBranch.text} ❌
            </div>
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
