/**
 * ColorGrid — 多色块网格
 * 用途: 并列分类、食物/症状列举
 *
 * 入场编排：标题 slideUp → 网格项从四角 scale+fade 依次弹入
 */

import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import type { SceneProps } from "../../types";
import {
  TYPOGRAPHY, FONT_FAMILY, SAFE_AREA, BORDER_RADIUS,
  categoryColor, tintBg, withAlpha,
} from "../../design-system";
import { slideUpIn, slideDownOut, mergeStyles, stagger } from "../../animations/index";
import { msToFrame } from "../../utils";

export const ColorGrid: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enterMs = scene.timeline.enter_ms;
  const enterStart = msToFrame(scene.timeline.first_anchor_ms - enterMs, fps);
  const dwellEnd = msToFrame(scene.timeline.dwell_end_ms - enterMs, fps);

  // ---- Title ----
  const titleEntry = slideUpIn(frame, enterStart, fps);
  const titleExit = slideDownOut(frame, dwellEnd, fps);
  const titleStyle = mergeStyles(titleEntry, titleExit);

  // ---- Grid items: staggered scale+fade entrance ----
  const getGridStyle = (i: number) => {
    const item = scene.items[i];
    const delay = item?.anchor_offset_ms !== undefined
      ? msToFrame(item.anchor_offset_ms, fps)
      : enterStart + 6 + stagger(i, 5); // 6 frames after title

    const progress = spring({
      frame: frame - delay,
      fps,
      config: { mass: 1, damping: 12, stiffness: 150 },
    });
    const scale = interpolate(progress, [0, 1], [0.7, 1]);
    const opacity = interpolate(progress, [0, 1], [0, 1]);

    const exit = slideDownOut(frame, dwellEnd, fps);

    return {
      opacity: Math.max(0, opacity) * exit.opacity,
      transform: `scale(${scale}) ${exit.transform ?? ""}`.trim(),
      filter: exit.filter,
    };
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
      {/* 标题 */}
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

      {/* 网格 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
        }}
      >
        {scene.items.map((item, i) => {
          const color = categoryColor(i);
          const icon = item.emoji;
          const gridStyle = getGridStyle(i);
          return (
            <div
              key={(item.id ?? "") + i}
              style={{
                padding: "24px",
                borderRadius: BORDER_RADIUS.md,
                textAlign: "center",
                background: tintBg(color, 0.08),
                border: `1px solid ${withAlpha(color, 0.15)}`,
                opacity: gridStyle.opacity,
                transform: gridStyle.transform,
                filter: gridStyle.filter,
              }}
            >
              {icon && (
                <div style={{ fontSize: 48, marginBottom: 8 }}>{icon}</div>
              )}
              <div
                style={{
                  fontSize: TYPOGRAPHY.body.fontSize,
                  fontWeight: TYPOGRAPHY.body.fontWeight,
                  color: "rgba(15, 23, 42, 0.88)",
                  fontFamily: FONT_FAMILY.sans,
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
