/**
 * VerticalTimeline — 纵向时间线
 * 用途: 时间序列、一天作息、治疗阶段
 *
 * 入场编排：标题 slideUp → 时间节点逐个从上 slideDown + scaleIn
 * 虚线连接随节点同步出现
 */

import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import type { SceneProps } from "../../types";
import {
  TYPOGRAPHY, FONT_FAMILY, SAFE_AREA, BORDER_RADIUS,
  categoryColor, withAlpha,
} from "../../design-system";
import { slideUpIn, slideDownOut, mergeStyles, stagger } from "../../animations/index";
import { msToFrame } from "../../utils";

export const VerticalTimeline: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enterMs = scene.timeline.enter_ms;
  const enterStart = msToFrame(scene.timeline.first_anchor_ms - enterMs, fps);
  const dwellEnd = msToFrame(scene.timeline.dwell_end_ms - enterMs, fps);

  // ---- Title ----
  const titleEntry = slideUpIn(frame, enterStart, fps);
  const titleExit = slideDownOut(frame, dwellEnd, fps);
  const titleStyle = mergeStyles(titleEntry, titleExit);

  // ---- Timeline nodes: staggered entrance ----
  const getNodeStyle = (i: number) => {
    const item = scene.items[i];
    const delay = item?.anchor_offset_ms !== undefined
      ? msToFrame(item.anchor_offset_ms, fps)
      : enterStart + 6 + stagger(i, 7); // wider stagger for timeline feel

    const progress = spring({
      frame: frame - delay,
      fps,
      config: { mass: 1, damping: 12, stiffness: 140 },
    });
    const y = interpolate(progress, [0, 1], [25, 0]);
    const scale = interpolate(progress, [0, 1], [0.85, 1]);
    const opacity = interpolate(progress, [0, 1], [0, 1]);
    const exit = slideDownOut(frame, dwellEnd, fps);

    return {
      opacity: Math.max(0, opacity) * exit.opacity,
      transform: `translateY(${y}px) scale(${scale}) ${exit.transform ?? ""}`.trim(),
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

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {scene.items.map((item, i) => {
          const color = categoryColor(i);
          const isLast = i === scene.items.length - 1;
          // 如果文本中有冒号或"—"，分为时间+内容
          const parts = item.text.split(/[:：—]/);
          const timeLabel = parts.length > 1 ? parts[0].trim() : undefined;
          const content = parts.length > 1 ? parts.slice(1).join(":").trim() : item.text;
          const nodeStyle = getNodeStyle(i);

          return (
            <React.Fragment key={(item.id ?? "") + i}>
              <div
                style={{
                  display: "flex",
                  gap: 20,
                  alignItems: "flex-start",
                  opacity: nodeStyle.opacity,
                  transform: nodeStyle.transform,
                  filter: nodeStyle.filter,
                }}
              >
                {/* 时间线圆点 */}
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: BORDER_RADIUS.full,
                    background: color,
                    flexShrink: 0,
                    marginTop: 4,
                  }}
                />
                <div>
                  {timeLabel && (
                    <div
                      style={{
                        fontSize: TYPOGRAPHY.caption.fontSize,
                        color: "rgba(15, 23, 42, 0.4)",
                        fontFamily: FONT_FAMILY.sans,
                      }}
                    >
                      {timeLabel}
                    </div>
                  )}
                  <div
                    style={{
                      fontSize: TYPOGRAPHY.caption.fontSize + 6,
                      color: "rgba(15, 23, 42, 0.7)",
                      fontFamily: FONT_FAMILY.sans,
                      lineHeight: 1.4,
                    }}
                  >
                    {content}
                  </div>
                </div>
              </div>
              {/* 虚线连接 */}
              {!isLast && (
                <div
                  style={{
                    width: 0,
                    height: 24,
                    marginLeft: 10,
                    borderLeft: `2px dashed ${withAlpha(categoryColor(i), 0.25)}`,
                    opacity: nodeStyle.opacity,
                  }}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
