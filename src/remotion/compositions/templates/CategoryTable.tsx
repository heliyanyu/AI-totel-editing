/**
 * CategoryTable — 分类表格
 * 用途: 等级/分级对照（血压分类、风险分级）
 *
 * 入场编排：标题 slideUp → 行逐条 slideRight 滑入（anchor-driven stagger）
 * 最后一行（最严重等级）scalePop 强调
 */

import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import type { SceneProps } from "../../types";
import {
  TYPOGRAPHY, FONT_FAMILY, SAFE_AREA, SEMANTIC_COLORS, BORDER_RADIUS,
  tintBg,
} from "../../design-system";
import { slideUpIn, slideDownOut, mergeStyles, stagger } from "../../animations/index";
import { msToFrame } from "../../utils";

// 按严重程度递增的颜色
const SEVERITY_COLORS = [
  SEMANTIC_COLORS.positive,   // 正常 - 绿
  SEMANTIC_COLORS.highlight,  // 偏高 - 琥珀
  SEMANTIC_COLORS.negative,   // 高 - 红
  "#991B1B",                  // 危急 - 深红
];

export const CategoryTable: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enterMs = scene.timeline.enter_ms;
  const enterStart = msToFrame(scene.timeline.first_anchor_ms - enterMs, fps);
  const dwellEnd = msToFrame(scene.timeline.dwell_end_ms - enterMs, fps);

  // items 按 pair: [label1, value1, label2, value2, ...]
  const rows: { label: string; value: string }[] = [];
  for (let i = 0; i < scene.items.length; i += 2) {
    rows.push({
      label: scene.items[i]?.text ?? "",
      value: scene.items[i + 1]?.text ?? "",
    });
  }

  // ---- Title ----
  const titleEntry = slideUpIn(frame, enterStart, fps);
  const titleExit = slideDownOut(frame, dwellEnd, fps);
  const titleStyle = mergeStyles(titleEntry, titleExit);

  // ---- Row styles: staggered slideIn from right ----
  const getRowStyle = (rowIdx: number) => {
    // Use anchor from even-index items (the label items)
    const itemIdx = rowIdx * 2;
    const item = scene.items[itemIdx];
    const delay = item?.anchor_offset_ms !== undefined
      ? msToFrame(item.anchor_offset_ms, fps)
      : enterStart + 6 + stagger(rowIdx, 6);

    const progress = spring({
      frame: frame - delay,
      fps,
      config: { mass: 1, damping: 12, stiffness: 140 },
    });
    const x = interpolate(progress, [0, 1], [40, 0]);
    const opacity = interpolate(progress, [0, 1], [0, 1]);
    const exit = slideDownOut(frame, dwellEnd, fps);

    return {
      opacity: Math.max(0, opacity) * exit.opacity,
      transform: `translateX(${x}px) ${exit.transform ?? ""}`.trim(),
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

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {rows.map((row, i) => {
          const color = SEVERITY_COLORS[Math.min(i, SEVERITY_COLORS.length - 1)];
          const isLast = i === rows.length - 1;
          const rowStyle = getRowStyle(i);
          return (
            <div
              key={i}
              style={{
                display: "flex",
                borderRadius: BORDER_RADIUS.sm,
                overflow: "hidden",
                opacity: rowStyle.opacity,
                transform: rowStyle.transform,
                filter: rowStyle.filter,
              }}
            >
              {/* 标签列 */}
              <div
                style={{
                  width: "35%",
                  padding: "14px 20px",
                  background: tintBg(color, 0.12),
                  fontSize: TYPOGRAPHY.caption.fontSize + 6,
                  fontWeight: isLast ? 700 : 600,
                  color: color,
                  fontFamily: FONT_FAMILY.sans,
                  borderRadius: `${BORDER_RADIUS.sm}px 0 0 ${BORDER_RADIUS.sm}px`,
                }}
              >
                {row.label}
              </div>
              {/* 值列 */}
              <div
                style={{
                  flex: 1,
                  padding: "14px 20px",
                  background: tintBg(color, 0.04),
                  fontSize: TYPOGRAPHY.caption.fontSize + 6,
                  color: "rgba(15, 23, 42, 0.7)",
                  fontFamily: FONT_FAMILY.sans,
                  borderRadius: `0 ${BORDER_RADIUS.sm}px ${BORDER_RADIUS.sm}px 0`,
                }}
              >
                {row.value}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
