import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { SceneProps } from "../../types";
import { FONT_FAMILY, TYPOGRAPHY, withAlpha } from "../../design-system";
import { fadeIn, mergeStyles, slideDownOut, slideUpIn } from "../../animations/index";
import { pulse } from "../../animations/compose";
import { msToFrame } from "../../utils";
import {
  AccentBadge,
  getPlannerMeta,
  TemplateHeader,
  TemplatePanel,
  TemplateStage,
} from "../template-primitives";
import { SCENE_TONE } from "../../visual-language";

export const HeroText: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enterMs = scene.timeline.enter_ms;
  const enterStart = msToFrame(scene.timeline.first_anchor_ms - enterMs, fps);
  const dwellEnd = msToFrame(scene.timeline.dwell_end_ms - enterMs, fps);

  const meta = getPlannerMeta(scene);
  const tone = SCENE_TONE[meta.tone];
  const text = scene.items[0]?.text ?? scene.title ?? "";
  const heroEmoji = scene.items[0]?.emoji;
  const subtitle = scene.items[1]?.text;

  const panelEntry = slideUpIn(frame, enterStart + 4, fps, 40);
  const panelExit = slideDownOut(frame, dwellEnd, fps);
  const panelStyle = mergeStyles(panelEntry, panelExit);

  const textEntry = fadeIn(frame, enterStart + 10, fps);
  const textStyle = mergeStyles(textEntry, panelExit);
  const drift = 1 + pulse(frame, fps, 2600, 0.018);

  return (
    <TemplateStage
      scene={scene}
      vertical={meta.layout === "spotlight" || meta.layout === "overlay_center" ? "center" : "top"}
      maxWidth={meta.isOverlay ? 680 : 900}
    >
      <TemplateHeader
        scene={scene}
        title={scene.title}
        tone={meta.tone}
        align={meta.layout === "spotlight" || meta.layout === "overlay_center" ? "center" : "left"}
      />

      <TemplatePanel
        tone={meta.tone}
        accent="left"
        padding={meta.isOverlay ? "30px 30px 32px" : "38px 40px 40px"}
        style={{
          opacity: panelStyle.opacity,
          transform: `${panelStyle.transform ?? ""} scale(${drift})`.trim(),
          filter: panelStyle.filter,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: -40,
            background: `radial-gradient(circle at 85% 18%, ${tone.glow}, transparent 38%)`,
          }}
        />

        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          {heroEmoji && (
            <div
              style={{
                fontSize: 120,
                lineHeight: 1,
                textAlign:
                  meta.layout === "spotlight" || meta.layout === "overlay_center"
                    ? "center"
                    : "left",
              }}
            >
              {heroEmoji}
            </div>
          )}

          <div
            style={{
              fontFamily: FONT_FAMILY.sans,
              fontSize: meta.isOverlay ? 78 : 88,
              fontWeight: 800,
              lineHeight: 1.08,
              color: "#0F172A",
              textAlign:
                meta.layout === "spotlight" || meta.layout === "overlay_center"
                  ? "center"
                  : "left",
              opacity: textStyle.opacity,
              filter: textStyle.filter,
            }}
          >
            {text}
          </div>

          {subtitle && (
            <div
              style={{
                fontFamily: FONT_FAMILY.sans,
                fontSize: TYPOGRAPHY.caption.fontSize + 2,
                fontWeight: 500,
                lineHeight: 1.3,
                color: withAlpha("#0F172A", 0.62),
                textAlign:
                  meta.layout === "spotlight" || meta.layout === "overlay_center"
                    ? "center"
                    : "left",
              }}
            >
              {subtitle}
            </div>
          )}
        </div>
      </TemplatePanel>
    </TemplateStage>
  );
};
