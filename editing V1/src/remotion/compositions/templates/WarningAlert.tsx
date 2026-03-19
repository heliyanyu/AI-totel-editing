/**
 * WarningAlert — 警示卡片
 * 用途: 危害后果、禁忌警告
 *
 * 入场编排：emoji scalePop 弹入 → 卡片 slideUp + shake 震入
 */

import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import type { SceneProps } from "../../types";
import {
  TYPOGRAPHY, FONT_FAMILY, SAFE_AREA, SEMANTIC_COLORS,
  GLASS_CARD, BORDER_RADIUS, withAlpha, tintBg,
} from "../../design-system";
import { slideUpIn, slideDownOut, fadeIn, mergeStyles } from "../../animations/index";
import { msToFrame } from "../../utils";
import { pulseGlowShadow } from "../../animations/compose";

export const WarningAlert: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enterMs = scene.timeline.enter_ms;
  const enterStart = msToFrame(scene.timeline.first_anchor_ms - enterMs, fps);
  const dwellEnd = msToFrame(scene.timeline.dwell_end_ms - enterMs, fps);

  const mainText = scene.items[0]?.text ?? "";
  const alertEmoji = scene.items[0]?.emoji || "\u26a0\ufe0f";
  const subText = scene.items[1]?.text ?? "";

  // ---- Emoji: dramatic scalePop (0.2 → 1.2 → 1.0) ----
  const emojiProgress = spring({
    frame: frame - enterStart,
    fps,
    config: { mass: 1, damping: 8, stiffness: 140 }, // very bouncy
  });
  const emojiScale = interpolate(emojiProgress, [0, 1], [0.2, 1]);
  const emojiOpacity = interpolate(emojiProgress, [0, 0.3], [0, 1], {
    extrapolateRight: "clamp",
  });

  // ---- Card: delayed entrance (10 frames after emoji) ----
  const cardDelay = enterStart + 10;
  const cardEntry = slideUpIn(frame, cardDelay, fps, 60);
  const cardExit = slideDownOut(frame, dwellEnd, fps);
  const cardStyle = mergeStyles(cardEntry, cardExit);

  // ---- Text: further delayed (14 frames after emoji) ----
  const textDelay = enterStart + 14;
  const textEntry = fadeIn(frame, textDelay, fps);
  const textExit = slideDownOut(frame, dwellEnd, fps);
  const textStyle = mergeStyles(textEntry, textExit);

  // ---- Subtitle: even more delayed (20 frames after emoji) ----
  const subDelay = enterStart + 20;
  const subEntry = fadeIn(frame, subDelay, fps);
  const subExit = slideDownOut(frame, dwellEnd, fps);
  const subStyle = mergeStyles(subEntry, subExit);

  // ---- Emoji exit ----
  const emojiExit = slideDownOut(frame, dwellEnd, fps);

  // ---- Shake animation (periodic during dwell) ----
  const shakePhase = (frame % 75) / 75;
  const isShaking = shakePhase > 0.7 && shakePhase < 0.85;
  const shakeX = isShaking
    ? 6 * Math.sin((shakePhase - 0.7) / 0.15 * Math.PI * 8) * (1 - (shakePhase - 0.7) / 0.15)
    : 0;

  // ---- Dwell emphasis: red pulsing glow on card ----
  const isDwelling = frame > cardDelay + 15 && frame < dwellEnd;
  const cardGlow = isDwelling
    ? pulseGlowShadow(frame, fps, SEMANTIC_COLORS.negative, 1500, 20, 6)
    : undefined;

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
          background: tintBg(SEMANTIC_COLORS.negative, 0.06),
          borderLeft: `5px solid ${SEMANTIC_COLORS.negative}`,
          padding: "54px",
          minWidth: 660,
          textAlign: "center",
          opacity: cardStyle.opacity,
          transform: `${cardStyle.transform ?? ""} translateX(${shakeX}px)`.trim(),
          filter: cardStyle.filter,
          boxShadow: cardGlow,
        }}
      >
        <div
          style={{
            fontSize: 360,
            marginBottom: 24,
            lineHeight: 1,
            opacity: emojiOpacity * emojiExit.opacity,
            transform: `scale(${emojiScale})`,
          }}
        >
          {alertEmoji}
        </div>
        <div
          style={{
            fontSize: Math.round(TYPOGRAPHY.body.fontSize * 1.1),
            fontWeight: 700,
            color: SEMANTIC_COLORS.negative,
            fontFamily: FONT_FAMILY.sans,
            opacity: textStyle.opacity,
            filter: textStyle.filter,
          }}
        >
          {mainText}
        </div>
        {subText && (
          <div
            style={{
              marginTop: 14,
              fontSize: Math.round(TYPOGRAPHY.caption.fontSize * 1.1),
              color: "rgba(15, 23, 42, 0.55)",
              fontFamily: FONT_FAMILY.sans,
              opacity: subStyle.opacity,
              filter: subStyle.filter,
            }}
          >
            {subText}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
