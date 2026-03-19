/**
 * SplitColumn — 左右分栏对比
 * 用途: A vs B 对照（脂肪类型、用药对比）
 *
 * 入场编排：标题 slideUp → 左列 slideRight → 右列 slideLeft（逐行交替）
 */

import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import type { SceneProps } from "../../types";
import {
  TYPOGRAPHY, FONT_FAMILY, SAFE_AREA, SEMANTIC_COLORS, BORDER_RADIUS,
  categoryColor, tintBg, withAlpha,
} from "../../design-system";
import { slideUpIn, slideDownOut, fadeIn, mergeStyles } from "../../animations/index";
import { msToFrame } from "../../utils";

export const SplitColumn: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enterMs = scene.timeline.enter_ms;
  const enterStart = msToFrame(scene.timeline.first_anchor_ms - enterMs, fps);
  const dwellEnd = msToFrame(scene.timeline.dwell_end_ms - enterMs, fps);

  const leftLabel = (scene.template_props?.left_label as string) ?? "A";
  const rightLabel = (scene.template_props?.right_label as string) ?? "B";

  // items 按 pair 排列: [left1, right1, left2, right2, ...]
  const leftItems: string[] = [];
  const rightItems: string[] = [];
  scene.items.forEach((item, i) => {
    if (i % 2 === 0) leftItems.push(item.text);
    else rightItems.push(item.text);
  });

  const leftColor = categoryColor(0); // 蓝
  const rightColor = SEMANTIC_COLORS.positive; // 绿

  // ---- Title ----
  const titleEntry = slideUpIn(frame, enterStart, fps);
  const titleExit = slideDownOut(frame, dwellEnd, fps);
  const titleStyle = mergeStyles(titleEntry, titleExit);

  // ---- Left column: slide in from left (8 frames delay) ----
  const leftDelay = enterStart + 8;
  const leftProgress = spring({
    frame: frame - leftDelay,
    fps,
    config: { mass: 1, damping: 12, stiffness: 140 },
  });
  const leftX = interpolate(leftProgress, [0, 1], [-50, 0]);
  const leftOpacity = interpolate(leftProgress, [0, 1], [0, 1]);
  const leftExit = slideDownOut(frame, dwellEnd, fps);

  // ---- Right column: slide in from right (14 frames delay) ----
  const rightDelay = enterStart + 14;
  const rightProgress = spring({
    frame: frame - rightDelay,
    fps,
    config: { mass: 1, damping: 12, stiffness: 140 },
  });
  const rightX = interpolate(rightProgress, [0, 1], [50, 0]);
  const rightOpacity = interpolate(rightProgress, [0, 1], [0, 1]);
  const rightExit = slideDownOut(frame, dwellEnd, fps);

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
            marginBottom: 16,
            opacity: titleStyle.opacity,
            transform: titleStyle.transform,
            filter: titleStyle.filter,
          }}
        >
          {scene.title}
        </div>
      )}

      <div style={{ display: "flex", gap: 14 }}>
        {/* 左列 */}
        <div
          style={{
            flex: 1,
            borderRadius: BORDER_RADIUS.md,
            padding: 20,
            background: tintBg(leftColor, 0.06),
            borderTop: `5px solid ${leftColor}`,
            opacity: leftOpacity * leftExit.opacity,
            transform: `translateX(${leftX}px) ${leftExit.transform ?? ""}`.trim(),
          }}
        >
          <div
            style={{
              fontSize: TYPOGRAPHY.caption.fontSize + 6,
              fontWeight: 600,
              color: leftColor,
              textAlign: "center",
              marginBottom: 12,
              fontFamily: FONT_FAMILY.sans,
            }}
          >
            {leftLabel}
          </div>
          {leftItems.map((text, i) => (
            <div
              key={`l${i}`}
              style={{
                fontSize: TYPOGRAPHY.caption.fontSize,
                color: "rgba(15, 23, 42, 0.7)",
                textAlign: "center",
                padding: "8px 0",
                borderBottom: i < leftItems.length - 1 ? "1px solid rgba(0,0,0,0.05)" : undefined,
                fontFamily: FONT_FAMILY.sans,
              }}
            >
              {text}
            </div>
          ))}
        </div>

        {/* 右列 */}
        <div
          style={{
            flex: 1,
            borderRadius: BORDER_RADIUS.md,
            padding: 20,
            background: tintBg(rightColor, 0.06),
            borderTop: `5px solid ${rightColor}`,
            opacity: rightOpacity * rightExit.opacity,
            transform: `translateX(${rightX}px) ${rightExit.transform ?? ""}`.trim(),
          }}
        >
          <div
            style={{
              fontSize: TYPOGRAPHY.caption.fontSize + 6,
              fontWeight: 600,
              color: rightColor,
              textAlign: "center",
              marginBottom: 12,
              fontFamily: FONT_FAMILY.sans,
            }}
          >
            {rightLabel}
          </div>
          {rightItems.map((text, i) => (
            <div
              key={`r${i}`}
              style={{
                fontSize: TYPOGRAPHY.caption.fontSize,
                color: "rgba(15, 23, 42, 0.7)",
                textAlign: "center",
                padding: "8px 0",
                borderBottom: i < rightItems.length - 1 ? "1px solid rgba(0,0,0,0.05)" : undefined,
                fontFamily: FONT_FAMILY.sans,
              }}
            >
              {text}
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
