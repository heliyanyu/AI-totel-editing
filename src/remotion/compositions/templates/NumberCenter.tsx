/**
 * NumberCenter — 大数字居中
 * 用途: 关键数据、百分比、诊断标准
 *
 * 入场编排：数字 numBounce 弹入 → 单位 fadeIn → 说明文字 fadeIn
 * 驻留强调：数字持续弹跳呼吸 + scale脉冲
 */

import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import type { SceneProps } from "../../types";
import {
  TYPOGRAPHY, FONT_FAMILY, SAFE_AREA, SEMANTIC_COLORS,
  GLASS_CARD, SHADOWS, BORDER_RADIUS,
} from "../../design-system";
import { slideUpIn, slideDownOut, fadeIn, mergeStyles } from "../../animations/index";
import { msToFrame } from "../../utils";
import { pulse, numBounce } from "../../animations/compose";
import { VISUAL_SHELL } from "../../visual-language";
import { getPlannerMeta } from "../template-primitives";

export const NumberCenter: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enterMs = scene.timeline.enter_ms;
  const enterStart = msToFrame(scene.timeline.first_anchor_ms - enterMs, fps);
  const dwellEnd = msToFrame(scene.timeline.dwell_end_ms - enterMs, fps);

  const text = scene.items[0]?.text ?? "";
  const context = (scene.template_props?.context as string) ?? "";
  const unit = (scene.template_props?.unit as string) ?? "";

  // ---- Card: slideUp entrance ----
  const cardEntry = slideUpIn(frame, enterStart, fps);
  const cardExit = slideDownOut(frame, dwellEnd, fps);
  const cardStyle = mergeStyles(cardEntry, cardExit);

  // ---- Number: numBounce entrance ----
  const numAnim = numBounce(frame, enterStart, fps, 24, 1.12);

  // ---- Number exit ----
  const numExit = slideDownOut(frame, dwellEnd, fps);

  // ---- Unit: delayed fadeIn (8 frames) ----
  const unitDelay = enterStart + 8;
  const unitEntry = fadeIn(frame, unitDelay, fps);
  const unitExit = slideDownOut(frame, dwellEnd, fps);
  const unitStyle = mergeStyles(unitEntry, unitExit);

  // ---- Context: further delayed fadeIn (14 frames) ----
  const ctxDelay = enterStart + 14;
  const ctxEntry = fadeIn(frame, ctxDelay, fps);
  const ctxExit = slideDownOut(frame, dwellEnd, fps);
  const ctxStyle = mergeStyles(ctxEntry, ctxExit);

  // ---- Dwell: number breathing pulse ----
  const isDwelling = frame > enterStart + 15 && frame < dwellEnd;
  const bounceY = isDwelling ? -14 * pulse(frame, fps, 1800, 1) : 0;
  const bounceScale = isDwelling ? 1 + pulse(frame, fps, 1800, 0.05) : 1;

  const meta = getPlannerMeta(scene);
  const topPad = meta.isOverlay ? SAFE_AREA.top + VISUAL_SHELL.overlayTopOffset : SAFE_AREA.top;
  const bottomPad = meta.isOverlay ? Math.max(160, SAFE_AREA.bottom - VISUAL_SHELL.overlayBottomInset) : SAFE_AREA.bottom;

  return (
    <AbsoluteFill
      style={{
        padding: `${topPad}px ${SAFE_AREA.horizontal}px ${bottomPad}px`,
        display: "flex",
        justifyContent: "flex-start",
        alignItems: "center",
      }}
    >
      <div
        style={{
          ...GLASS_CARD,
          padding: "36px 48px",
          textAlign: "center",
          opacity: cardStyle.opacity,
          transform: cardStyle.transform,
          filter: cardStyle.filter,
        }}
      >
        <div
          style={{
            fontSize: TYPOGRAPHY.heroNumber.fontSize,
            fontWeight: TYPOGRAPHY.heroNumber.fontWeight,
            lineHeight: TYPOGRAPHY.heroNumber.lineHeight,
            fontFamily: FONT_FAMILY.number,
            color: SEMANTIC_COLORS.negative,
            display: "inline-block",
            opacity: numAnim.opacity * numExit.opacity,
            transform: `${numAnim.transform ?? ""} translateY(${bounceY}px) scale(${bounceScale}) ${numExit.transform ?? ""}`.trim(),
          }}
        >
          {text}
          {unit && (
            <span
              style={{
                fontSize: TYPOGRAPHY.caption.fontSize,
                color: "rgba(15, 23, 42, 0.5)",
                fontFamily: FONT_FAMILY.sans,
                marginLeft: 8,
                opacity: unitStyle.opacity,
              }}
            >
              {unit}
            </span>
          )}
        </div>
        {context && (
          <div
            style={{
              marginTop: 12,
              fontSize: TYPOGRAPHY.caption.fontSize,
              color: "rgba(15, 23, 42, 0.55)",
              fontFamily: FONT_FAMILY.sans,
              opacity: ctxStyle.opacity,
              filter: ctxStyle.filter,
            }}
          >
            {context}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
