import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { SceneProps } from "../../types";
import { FONT_FAMILY, TYPOGRAPHY } from "../../design-system";
import { fadeIn, mergeStyles, slideDownOut, slideUpIn } from "../../animations/index";
import { msToFrame } from "../../utils";
import { useSceneAnimation } from "../useSceneAnimation";
import {
  AccentBadge,
  getPlannerMeta,
  SectionNote,
  TemplateHeader,
  TemplatePanel,
  TemplateStage,
} from "../template-primitives";

export const ListFade: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enterMs = scene.timeline.enter_ms;
  const enterStart = msToFrame(scene.timeline.first_anchor_ms - enterMs, fps);
  const dwellEnd = msToFrame(scene.timeline.dwell_end_ms - enterMs, fps);

  const meta = getPlannerMeta(scene);
  const { getItemStyle } = useSceneAnimation(scene, 5);
  const headerEntry = slideUpIn(frame, enterStart, fps, 26);
  const headerExit = slideDownOut(frame, dwellEnd, fps);
  const headerStyle = mergeStyles(headerEntry, headerExit);
  const boardFade = mergeStyles(fadeIn(frame, enterStart + 8, fps), headerExit);
  const columns = !meta.isOverlay && scene.items.length > 4 ? 2 : 1;

  return (
    <TemplateStage
      scene={scene}
      maxWidth={meta.isOverlay ? 560 : 840}
      vertical="top"
    >
      <div
        style={{
          opacity: headerStyle.opacity,
          transform: headerStyle.transform,
          filter: headerStyle.filter,
        }}
      >
        <TemplateHeader
          scene={scene}
          title={scene.title}
          tone={meta.tone}
        />
      </div>

      <div
        style={{
          opacity: boardFade.opacity,
          transform: boardFade.transform,
          filter: boardFade.filter,
          display: "grid",
          gridTemplateColumns: columns === 2 ? "1fr 1fr" : "1fr",
          gap: 16,
        }}
      >
        {scene.items.map((item, index) => {
          const itemStyle = getItemStyle(index);
          return (
            <TemplatePanel
              key={(item.id ?? "") + index}
              tone={index === 0 ? meta.tone : "neutral"}
              accent="left"
              padding="22px 22px"
              style={{
                opacity: itemStyle.opacity,
                transform: itemStyle.transform,
                filter: itemStyle.filter,
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: 16,
                  alignItems: "flex-start",
                }}
              >
                <AccentBadge
                  label={item.emoji ?? String(index + 1)}
                  tone={index === 0 ? meta.tone : "info"}
                  size="lg"
                />

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      fontFamily: FONT_FAMILY.sans,
                      fontSize: TYPOGRAPHY.body.fontSize - 4,
                      fontWeight: 700,
                      lineHeight: 1.18,
                      color: "#0F172A",
                    }}
                  >
                    {item.text}
                  </div>

                </div>
              </div>
            </TemplatePanel>
          );
        })}
      </div>
    </TemplateStage>
  );
};
