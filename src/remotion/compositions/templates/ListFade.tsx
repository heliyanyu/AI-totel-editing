/**
 * ListFade — 逐条弹入列表
 * 用途: 有序列举、建议列表、食物推荐
 *
 * 入场编排：标题先 slideUp → 列表项 anchor-driven stagger slideUp
 * 已通过 useSceneAnimation anchor_offset_ms 实现智能 stagger
 */

import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { SceneProps } from "../../types";
import {
  TYPOGRAPHY, FONT_FAMILY, SAFE_AREA,
  GLASS_CARD, BORDER_RADIUS, categoryColor, withAlpha,
} from "../../design-system";
import { slideUpIn, slideDownOut, mergeStyles } from "../../animations/index";
import { useSceneAnimation } from "../useSceneAnimation";
import { msToFrame } from "../../utils";

export const ListFade: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enterMs = scene.timeline.enter_ms;
  const enterStart = msToFrame(scene.timeline.first_anchor_ms - enterMs, fps);
  const dwellEnd = msToFrame(scene.timeline.dwell_end_ms - enterMs, fps);

  const { getItemStyle } = useSceneAnimation(scene, 6); // wider stagger for list items

  // ---- Title: enters first ----
  const titleEntry = slideUpIn(frame, enterStart, fps);
  const titleExit = slideDownOut(frame, dwellEnd, fps);
  const titleStyle = mergeStyles(titleEntry, titleExit);

  return (
    <AbsoluteFill
      style={{
        padding: `${SAFE_AREA.top}px ${SAFE_AREA.horizontal}px ${SAFE_AREA.bottom}px`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-start",
        gap: 16,
      }}
    >
      {/* 场景标题 — 先于列表项出现 */}
      {scene.title && (
        <div
          style={{
            fontSize: TYPOGRAPHY.body.fontSize,
            fontWeight: 600,
            color: "rgba(15, 23, 42, 0.88)",
            fontFamily: FONT_FAMILY.sans,
            marginBottom: 4,
            opacity: titleStyle.opacity,
            transform: titleStyle.transform,
            filter: titleStyle.filter,
          }}
        >
          {scene.title}
        </div>
      )}

      {/* 列表项 — anchor-driven stagger */}
      {scene.items.map((item, i) => {
        const color = categoryColor(i);
        return (
          <div
            key={(item.id ?? "") + i}
            style={{
              ...GLASS_CARD,
              padding: "20px 24px",
              borderLeft: `5px solid ${color}`,
              display: "flex",
              alignItems: "center",
              gap: 16,
              ...getItemStyle(i),
            }}
          >
            {/* Emoji 或编号徽章 */}
            {item.emoji ? (
              <div
                style={{
                  width: 56,
                  height: 56,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 40,
                  flexShrink: 0,
                }}
              >
                {item.emoji}
              </div>
            ) : (
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: BORDER_RADIUS.full,
                  background: `linear-gradient(135deg, ${color}, ${withAlpha(color, 0.7)})`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 22,
                  color: "#fff",
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {i + 1}
              </div>
            )}
            {/* 文本 */}
            <div
              style={{
                fontSize: TYPOGRAPHY.body.fontSize,
                fontWeight: TYPOGRAPHY.body.fontWeight,
                color: "rgba(15, 23, 42, 0.88)",
                fontFamily: FONT_FAMILY.sans,
                lineHeight: TYPOGRAPHY.body.lineHeight,
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
