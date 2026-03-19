/**
 * TermCard — 术语卡片
 * 用途: 名词解释、概念定义
 *
 * 入场编排：emoji scalePop → 术语名 slideUp + glow → 释义 fadeIn
 */

import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import type { SceneProps } from "../../types";
import {
  TYPOGRAPHY, FONT_FAMILY, SAFE_AREA, SEMANTIC_COLORS,
  GLASS_CARD, withAlpha,
} from "../../design-system";
import { slideUpIn, slideDownOut, fadeIn, mergeStyles } from "../../animations/index";
import { msToFrame } from "../../utils";
import { pulseGlowShadow } from "../../animations/compose";

export const TermCard: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enterMs = scene.timeline.enter_ms;
  const enterStart = msToFrame(scene.timeline.first_anchor_ms - enterMs, fps);
  const dwellEnd = msToFrame(scene.timeline.dwell_end_ms - enterMs, fps);

  const term = scene.items[0]?.text ?? scene.title ?? "";
  const termEmoji = scene.items[0]?.emoji;
  const definition = scene.items[1]?.text ?? "";

  // ---- Card: slideUp entrance ----
  const cardEntry = slideUpIn(frame, enterStart, fps);
  const cardExit = slideDownOut(frame, dwellEnd, fps);
  const cardStyle = mergeStyles(cardEntry, cardExit);

  // ---- Emoji: scalePop (starts with card) ----
  const emojiProgress = spring({
    frame: frame - enterStart,
    fps,
    config: { mass: 1, damping: 10, stiffness: 160 },
  });
  const emojiScale = interpolate(emojiProgress, [0, 1], [0.3, 1]);
  const emojiOpacity = interpolate(emojiProgress, [0, 0.3], [0, 1], {
    extrapolateRight: "clamp",
  });

  // ---- Term text: delayed slideUp (6 frames) ----
  const termDelay = enterStart + 6;
  const termEntry = slideUpIn(frame, termDelay, fps, 30);
  const termExit = slideDownOut(frame, dwellEnd, fps);
  const termStyle = mergeStyles(termEntry, termExit);

  // ---- Definition: further delayed fadeIn (14 frames) ----
  const defDelay = enterStart + 14;
  const defEntry = fadeIn(frame, defDelay, fps);
  const defExit = slideDownOut(frame, dwellEnd, fps);
  const defStyle = mergeStyles(defEntry, defExit);

  const glow = pulseGlowShadow(frame, fps, SEMANTIC_COLORS.info, 1500, 16, 4);

  return (
    <AbsoluteFill
      style={{
        padding: `${SAFE_AREA.top}px ${SAFE_AREA.horizontal}px ${SAFE_AREA.bottom}px`,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          ...GLASS_CARD,
          borderLeft: `5px solid ${SEMANTIC_COLORS.info}`,
          padding: "32px",
          opacity: cardStyle.opacity,
          transform: cardStyle.transform,
          filter: cardStyle.filter,
          boxShadow: glow,
        }}
      >
        {termEmoji && (
          <div
            style={{
              fontSize: 64,
              textAlign: "center",
              marginBottom: 12,
              opacity: emojiOpacity,
              transform: `scale(${emojiScale})`,
            }}
          >
            {termEmoji}
          </div>
        )}
        <div
          style={{
            fontSize: TYPOGRAPHY.title.fontSize,
            fontWeight: TYPOGRAPHY.title.fontWeight,
            color: "rgba(15, 23, 42, 0.88)",
            fontFamily: FONT_FAMILY.sans,
            textAlign: "center",
            marginBottom: 16,
            paddingBottom: 16,
            borderBottom: `2px solid ${withAlpha(SEMANTIC_COLORS.info, 0.2)}`,
            opacity: termStyle.opacity,
            transform: termStyle.transform,
            filter: termStyle.filter,
          }}
        >
          {term}
        </div>
        {definition && (
          <div
            style={{
              fontSize: TYPOGRAPHY.caption.fontSize,
              lineHeight: 1.6,
              color: "rgba(15, 23, 42, 0.55)",
              fontFamily: FONT_FAMILY.sans,
              textAlign: "center",
              opacity: defStyle.opacity,
              filter: defStyle.filter,
            }}
          >
            {definition}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
