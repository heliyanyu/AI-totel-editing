import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { SceneProps } from "../../types";
import { FONT_FAMILY, TYPOGRAPHY, withAlpha } from "../../design-system";
import { mergeStyles, slideDownOut, slideUpIn } from "../../animations/index";
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

export const StepArrow: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enterMs = scene.timeline.enter_ms;
  const enterStart = msToFrame(scene.timeline.first_anchor_ms - enterMs, fps);
  const dwellEnd = msToFrame(scene.timeline.dwell_end_ms - enterMs, fps);

  const meta = getPlannerMeta(scene);
  const tone = SCENE_TONE[meta.tone];
  const lastIndex = scene.items.length - 1;
  const delays = scene.items.map((item, index) =>
    item.anchor_offset_ms !== undefined
      ? msToFrame(item.anchor_offset_ms, fps)
      : enterStart + index * 7
  );

  return (
    <TemplateStage
      scene={scene}
      maxWidth={meta.isOverlay ? 620 : 760}
      vertical={meta.isOverlay ? "top" : "center"}
    >
      <TemplateHeader
        scene={scene}
        title={scene.title}
        tone={meta.tone}
      />

      <div
        style={{
          position: "relative",
          paddingLeft: 28,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 18,
            top: 18,
            bottom: 18,
            width: 3,
            borderRadius: 999,
            background: `linear-gradient(180deg, ${tone.solid}, ${withAlpha(tone.solid, 0.12)})`,
          }}
        />

        {scene.items.map((item, index) => {
          const isLast = index === lastIndex;
          const entry = slideUpIn(frame, delays[index] ?? enterStart + index * 7, fps, 28);
          const exit = slideDownOut(frame, dwellEnd, fps);
          const style = mergeStyles(entry, exit);
          const glow =
            isLast && frame > (delays[index] ?? 0) + 12 && frame < dwellEnd
              ? pulseGlowShadow(frame, fps, tone.solid, 1500, 18, 4)
              : undefined;

          return (
            <div
              key={(item.id ?? "") + index}
              style={{
                display: "grid",
                gridTemplateColumns: "56px 1fr",
                gap: 14,
                alignItems: "stretch",
                opacity: style.opacity,
                transform: style.transform,
                filter: style.filter,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  paddingTop: 8,
                }}
              >
                <AccentBadge
                  label={item.emoji ?? String(index + 1)}
                  tone={isLast ? "warning" : meta.tone}
                  size="lg"
                />
              </div>

              <TemplatePanel
                tone={isLast ? "warning" : index === 0 ? meta.tone : "neutral"}
                accent="left"
                padding="20px 22px"
                style={glow ? { boxShadow: glow } : undefined}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      fontFamily: FONT_FAMILY.sans,
                      fontSize: isLast ? TYPOGRAPHY.body.fontSize + 2 : TYPOGRAPHY.body.fontSize - 6,
                      fontWeight: isLast ? 800 : 700,
                      lineHeight: 1.16,
                      color: isLast ? tone.solid : "#0F172A",
                    }}
                  >
                    {item.text}
                  </div>

                </div>
              </TemplatePanel>
            </div>
          );
        })}
      </div>
    </TemplateStage>
  );
};
