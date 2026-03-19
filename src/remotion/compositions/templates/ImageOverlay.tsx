/**
 * ImageOverlay — 图片叠加文字
 * 用途: 场景描写、visual_mode="manual" 场景
 *
 * 入场编排：背景渐暗 → 文字框 slideUp → 标题 fadeIn → 副标题 fadeIn
 */

import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import type { SceneProps } from "../../types";
import {
  TYPOGRAPHY, FONT_FAMILY, SAFE_AREA, BORDER_RADIUS,
} from "../../design-system";
import { slideUpIn, slideDownOut, fadeIn, mergeStyles } from "../../animations/index";
import { msToFrame } from "../../utils";

export const ImageOverlay: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enterMs = scene.timeline.enter_ms;
  const enterStart = msToFrame(scene.timeline.first_anchor_ms - enterMs, fps);
  const dwellEnd = msToFrame(scene.timeline.dwell_end_ms - enterMs, fps);

  const title = scene.items[0]?.text ?? scene.title ?? "";
  const subtitle = scene.items[1]?.text ?? "";

  // ---- Background overlay: fade in ----
  const bgEntry = fadeIn(frame, enterStart, fps);

  // ---- Text box: delayed slideUp (6 frames) ----
  const boxDelay = enterStart + 6;
  const boxEntry = slideUpIn(frame, boxDelay, fps, 30);
  const boxExit = slideDownOut(frame, dwellEnd, fps);
  const boxStyle = mergeStyles(boxEntry, boxExit);

  // ---- Title: delayed fadeIn (10 frames) ----
  const titleDelay = enterStart + 10;
  const titleEntry = fadeIn(frame, titleDelay, fps);
  const titleExit = slideDownOut(frame, dwellEnd, fps);
  const titleStyle = mergeStyles(titleEntry, titleExit);

  // ---- Subtitle: further delayed fadeIn (16 frames) ----
  const subDelay = enterStart + 16;
  const subEntry = fadeIn(frame, subDelay, fps);
  const subExit = slideDownOut(frame, dwellEnd, fps);
  const subStyle = mergeStyles(subEntry, subExit);

  return (
    <AbsoluteFill>
      {/* 暗色渐变遮罩（模拟图片环境） */}
      <AbsoluteFill
        style={{
          background: "linear-gradient(180deg, rgba(60,100,60,0.5) 0%, rgba(30,50,30,0.75) 100%)",
          opacity: bgEntry.opacity,
        }}
      />
      {/* 底部文字框 */}
      <div
        style={{
          position: "absolute",
          left: SAFE_AREA.horizontal,
          right: SAFE_AREA.horizontal,
          bottom: SAFE_AREA.bottom + 24,
          background: "rgba(0, 0, 0, 0.35)",
          backdropFilter: "blur(10px)",
          borderRadius: BORDER_RADIUS.md,
          padding: "24px 28px",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          opacity: boxStyle.opacity,
          transform: boxStyle.transform,
          filter: boxStyle.filter,
        }}
      >
        <div
          style={{
            fontSize: TYPOGRAPHY.body.fontSize,
            fontWeight: 600,
            color: "rgba(255, 255, 255, 0.95)",
            fontFamily: FONT_FAMILY.sans,
            opacity: titleStyle.opacity,
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div
            style={{
              marginTop: 8,
              fontSize: TYPOGRAPHY.caption.fontSize,
              color: "rgba(255, 255, 255, 0.6)",
              fontFamily: FONT_FAMILY.sans,
              opacity: subStyle.opacity,
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
