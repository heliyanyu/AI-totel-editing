/**
 * HeroText — 全屏居中大字
 * 用途: 核心结论、金句、开场/结尾点题
 *
 * 入场编排：emoji scalePop → 文字 slideUp → 副标题 fadeIn
 */

import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import type { SceneProps } from "../../types";
import { TYPOGRAPHY, FONT_FAMILY, SAFE_AREA, SEMANTIC_COLORS } from "../../design-system";
import { slideUpIn, slideDownOut, fadeIn, mergeStyles } from "../../animations/index";
import { msToFrame } from "../../utils";
import { pulse } from "../../animations/compose";

export const HeroText: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enterMs = scene.timeline.enter_ms;
  const enterStart = msToFrame(scene.timeline.first_anchor_ms - enterMs, fps);
  const dwellEnd = msToFrame(scene.timeline.dwell_end_ms - enterMs, fps);

  const text = scene.items[0]?.text ?? scene.title ?? "";
  const heroEmoji = scene.items[0]?.emoji;
  const subtitle = scene.items[1]?.text;

  // ---- Emoji: scalePop entrance (scale 0.3 → 1.15 → 1.0) ----
  const emojiDelay = enterStart;
  const emojiProgress = spring({
    frame: frame - emojiDelay,
    fps,
    config: { mass: 1, damping: 10, stiffness: 160 }, // bouncy
  });
  const emojiScale = interpolate(emojiProgress, [0, 1], [0.3, 1]);
  const emojiOpacity = interpolate(emojiProgress, [0, 0.4], [0, 1], {
    extrapolateRight: "clamp",
  });

  // ---- Text: delayed slideUp entrance (8 frames after emoji) ----
  const textDelay = enterStart + 8;
  const textEntry = slideUpIn(frame, textDelay, fps, 50);
  const textExit = slideDownOut(frame, dwellEnd, fps);
  const textStyle = mergeStyles(textEntry, textExit);

  // ---- Subtitle: further delayed fadeIn (16 frames after emoji) ----
  const subDelay = enterStart + 16;
  const subEntry = fadeIn(frame, subDelay, fps);
  const subExit = slideDownOut(frame, dwellEnd, fps);
  const subStyle = mergeStyles(subEntry, subExit);

  // ---- Emoji exit ----
  const emojiExit = slideDownOut(frame, dwellEnd, fps);

  // 驻留期 scale 呼吸
  const breathScale = 1 + pulse(frame, fps, 2500, 0.02);

  return (
    <AbsoluteFill
      style={{
        padding: `${SAFE_AREA.top}px ${SAFE_AREA.horizontal}px ${SAFE_AREA.bottom}px`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        textAlign: "center",
      }}
    >
      {heroEmoji && (
        <div
          style={{
            fontSize: 96,
            marginBottom: 20,
            opacity: emojiOpacity * emojiExit.opacity,
            transform: `scale(${emojiScale * breathScale}) ${emojiExit.transform ?? ""}`.trim(),
            filter: emojiExit.filter,
          }}
        >
          {heroEmoji}
        </div>
      )}
      <div
        style={{
          fontSize: TYPOGRAPHY.title.fontSize,
          fontWeight: TYPOGRAPHY.title.fontWeight,
          lineHeight: TYPOGRAPHY.title.lineHeight,
          fontFamily: FONT_FAMILY.sans,
          color: "rgba(15, 23, 42, 0.88)",
          opacity: textStyle.opacity,
          transform: `${textStyle.transform ?? ""} scale(${breathScale})`.trim(),
          filter: textStyle.filter,
        }}
      >
        {text}
      </div>
      {subtitle && (
        <div
          style={{
            marginTop: 24,
            fontSize: TYPOGRAPHY.caption.fontSize,
            fontWeight: TYPOGRAPHY.caption.fontWeight,
            color: "rgba(15, 23, 42, 0.35)",
            fontFamily: FONT_FAMILY.sans,
            opacity: subStyle.opacity,
            filter: subStyle.filter,
          }}
        >
          {subtitle}
        </div>
      )}
    </AbsoluteFill>
  );
};
