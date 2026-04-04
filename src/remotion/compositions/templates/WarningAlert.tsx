import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { SceneProps } from "../../types";
import { FONT_FAMILY, TYPOGRAPHY, withAlpha } from "../../design-system";
import { fadeIn, mergeStyles, slideDownOut, slideUpIn } from "../../animations/index";
import { pulseGlowShadow } from "../../animations/compose";
import { msToFrame } from "../../utils";
import {
  AccentBadge,
  getPlannerMeta,
  SectionNote,
  TemplateHeader,
  TemplatePanel,
  TemplateStage,
} from "../template-primitives";
import { SCENE_TONE } from "../../visual-language";

export const WarningAlert: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enterMs = scene.timeline.enter_ms;
  const enterStart = msToFrame(scene.timeline.first_anchor_ms - enterMs, fps);
  const dwellEnd = msToFrame(scene.timeline.dwell_end_ms - enterMs, fps);

  const meta = getPlannerMeta(scene);
  const tone = SCENE_TONE.warning;
  const mainText = scene.items[0]?.text ?? "";
  const alertEmoji = scene.items[0]?.emoji ?? "!";
  const subText = scene.items[1]?.text ?? "";
  const panelStyle = mergeStyles(slideUpIn(frame, enterStart + 6, fps, 32), slideDownOut(frame, dwellEnd, fps));
  const labelStyle = mergeStyles(fadeIn(frame, enterStart, fps), slideDownOut(frame, dwellEnd, fps));
  const glow =
    frame > enterStart + 12 && frame < dwellEnd
      ? pulseGlowShadow(frame, fps, tone.solid, 1500, 18, 4)
      : undefined;

  return (
    <TemplateStage
      scene={scene}
      maxWidth={meta.isOverlay ? 580 : 720}
      vertical="top"
    >
      <div
        style={{
          opacity: labelStyle.opacity,
          transform: labelStyle.transform,
          filter: labelStyle.filter,
        }}
      >
        <TemplateHeader
          scene={scene}
          title={scene.title}
          tone="warning"
        />
      </div>

      <TemplatePanel
        tone="warning"
        accent="top"
        padding="28px 30px 30px"
        style={{
          opacity: panelStyle.opacity,
          transform: panelStyle.transform,
          filter: panelStyle.filter,
          boxShadow: glow ?? undefined,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "repeating-linear-gradient(-45deg, rgba(220,38,38,0.05) 0px, rgba(220,38,38,0.05) 12px, transparent 12px, transparent 24px)",
            pointerEvents: "none",
          }}
        />

        <div
          style={{
            position: "relative",
            display: "grid",
            gridTemplateColumns: "72px 1fr",
            gap: 18,
            alignItems: "start",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              paddingTop: 4,
            }}
          >
            <AccentBadge label={alertEmoji} tone="warning" size="lg" />
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div
              style={{
                fontFamily: FONT_FAMILY.sans,
                fontSize: meta.isOverlay ? 72 : 78,
                fontWeight: 800,
                lineHeight: 1.08,
                color: tone.solid,
              }}
            >
              {mainText}
            </div>

            {subText && (
              <div
                style={{
                  fontFamily: FONT_FAMILY.sans,
                  fontSize: TYPOGRAPHY.caption.fontSize + 4,
                  fontWeight: 600,
                  lineHeight: 1.28,
                  color: withAlpha("#0F172A", 0.7),
                }}
              >
                {subText}
              </div>
            )}

          </div>
        </div>
      </TemplatePanel>
    </TemplateStage>
  );
};
