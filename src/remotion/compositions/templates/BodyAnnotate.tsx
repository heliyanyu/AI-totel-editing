/**
 * BodyAnnotate — 人体/图示标注
 * 用途: 症状部位、器官关联
 *
 * 入场编排：标题 slideUp → 人体SVG fadeIn → 标注点逐个 scaleIn 弹出
 */

import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import type { SceneProps } from "../../types";
import {
  TYPOGRAPHY, FONT_FAMILY, SAFE_AREA, BORDER_RADIUS,
  categoryColor, withAlpha,
} from "../../design-system";
import { slideUpIn, slideDownOut, fadeIn, mergeStyles, stagger } from "../../animations/index";
import { msToFrame } from "../../utils";

export const BodyAnnotate: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enterMs = scene.timeline.enter_ms;
  const enterStart = msToFrame(scene.timeline.first_anchor_ms - enterMs, fps);
  const dwellEnd = msToFrame(scene.timeline.dwell_end_ms - enterMs, fps);

  // ---- Title ----
  const titleEntry = slideUpIn(frame, enterStart, fps);
  const titleExit = slideDownOut(frame, dwellEnd, fps);
  const titleStyle = mergeStyles(titleEntry, titleExit);

  // ---- SVG body: fadeIn (6 frames delay) ----
  const svgEntry = fadeIn(frame, enterStart + 6, fps);

  // ---- Annotation points: staggered scaleIn ----
  const getAnnotStyle = (i: number) => {
    const item = scene.items[i];
    const delay = item?.anchor_offset_ms !== undefined
      ? msToFrame(item.anchor_offset_ms, fps)
      : enterStart + 10 + stagger(i, 6);

    const progress = spring({
      frame: frame - delay,
      fps,
      config: { mass: 1, damping: 10, stiffness: 150 },
    });
    const scale = interpolate(progress, [0, 1], [0.3, 1]);
    const opacity = interpolate(progress, [0, 1], [0, 1]);
    const exit = slideDownOut(frame, dwellEnd, fps);

    return {
      opacity: Math.max(0, opacity) * exit.opacity,
      transform: `scale(${scale}) ${exit.transform ?? ""}`.trim(),
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
      }}
    >
      {/* 标题 */}
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

      {/* 人体示意 + 标注 */}
      <div style={{ position: "relative", width: 400, height: 700 }}>
        {/* 简化人体 SVG */}
        <svg
          viewBox="0 0 120 260"
          width={200}
          height={440}
          style={{
            position: "absolute",
            left: 100,
            top: 20,
            opacity: 0.15 * svgEntry.opacity,
          }}
        >
          {/* 头 */}
          <circle cx="60" cy="35" r="28" fill="none" stroke="#2563EB" strokeWidth="2" />
          {/* 身体 */}
          <rect x="38" y="68" width="44" height="95" rx="14" fill="none" stroke="#2563EB" strokeWidth="2" />
          {/* 左臂 */}
          <rect x="12" y="75" width="22" height="70" rx="8" fill="none" stroke="#2563EB" strokeWidth="2" />
          {/* 右臂 */}
          <rect x="86" y="75" width="22" height="70" rx="8" fill="none" stroke="#2563EB" strokeWidth="2" />
          {/* 左腿 */}
          <rect x="38" y="168" width="20" height="80" rx="8" fill="none" stroke="#2563EB" strokeWidth="2" />
          {/* 右腿 */}
          <rect x="62" y="168" width="20" height="80" rx="8" fill="none" stroke="#2563EB" strokeWidth="2" />
        </svg>

        {/* 标注点 — scaleIn stagger */}
        {scene.items.map((item, i) => {
          const color = categoryColor(i);
          const yPos = 30 + i * 130;
          const isLeft = i % 2 === 0;
          const annotStyle = getAnnotStyle(i);
          return (
            <div
              key={(item.id ?? "") + i}
              style={{
                position: "absolute",
                top: yPos,
                ...(isLeft ? { left: 0 } : { right: 0 }),
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexDirection: isLeft ? "row" : "row-reverse",
                opacity: annotStyle.opacity,
                transform: annotStyle.transform,
              }}
            >
              <div
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: BORDER_RADIUS.full,
                  background: color,
                  flexShrink: 0,
                }}
              />
              <div
                style={{
                  fontSize: TYPOGRAPHY.caption.fontSize,
                  color: "rgba(15, 23, 42, 0.7)",
                  fontFamily: FONT_FAMILY.sans,
                  fontWeight: 500,
                }}
              >
                {item.text}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
