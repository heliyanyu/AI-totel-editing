import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { SceneProps } from "../../types";
import { BORDER_RADIUS, FONT_FAMILY, TYPOGRAPHY, withAlpha } from "../../design-system";
import { fadeIn, mergeStyles, slideDownOut, slideUpIn } from "../../animations/index";
import { msToFrame } from "../../utils";
import {
  AccentBadge,
  getPlannerMeta,
  SectionNote,
  TemplateHeader,
  TemplatePanel,
  TemplateStage,
} from "../template-primitives";

export const SplitColumn: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enterMs = scene.timeline.enter_ms;
  const enterStart = msToFrame(scene.timeline.first_anchor_ms - enterMs, fps);
  const dwellEnd = msToFrame(scene.timeline.dwell_end_ms - enterMs, fps);

  const meta = getPlannerMeta(scene);
  const leftLabel = (scene.template_props?.left_label as string) ?? "A";
  const rightLabel = (scene.template_props?.right_label as string) ?? "B";
  const leftItems: string[] = [];
  const rightItems: string[] = [];
  scene.items.forEach((item, index) => {
    if (index % 2 === 0) {
      leftItems.push(item.text);
    } else {
      rightItems.push(item.text);
    }
  });

  const titleStyle = mergeStyles(slideUpIn(frame, enterStart, fps, 26), slideDownOut(frame, dwellEnd, fps));
  const boardStyle = mergeStyles(fadeIn(frame, enterStart + 8, fps), slideDownOut(frame, dwellEnd, fps));
  const rows = Math.max(leftItems.length, rightItems.length);

  return (
    <TemplateStage
      scene={scene}
      maxWidth={meta.isOverlay ? 640 : 860}
      vertical="top"
    >
      <div
        style={{
          opacity: titleStyle.opacity,
          transform: titleStyle.transform,
          filter: titleStyle.filter,
        }}
      >
        <TemplateHeader
          scene={scene}
          title={scene.title}
          tone="info"
        />
      </div>

      <TemplatePanel
        tone="info"
        accent="top"
        padding="24px 24px 26px"
        style={{
          opacity: boardStyle.opacity,
          transform: boardStyle.transform,
          filter: boardStyle.filter,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 56px 1fr",
            gap: 16,
            alignItems: "start",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <AccentBadge label={leftLabel} tone="brand" />
            {Array.from({ length: rows }, (_, row) => (
              <div
                key={`left-${row}`}
                style={{
                  minHeight: 90,
                  padding: "16px 16px 14px",
                  borderRadius: BORDER_RADIUS.md,
                  background: "rgba(255,255,255,0.78)",
                  border: `1px solid ${withAlpha("#2563EB", 0.18)}`,
                  display: "flex",
                  alignItems: "center",
                  fontFamily: FONT_FAMILY.sans,
                  fontSize: TYPOGRAPHY.caption.fontSize + 2,
                  fontWeight: 700,
                  lineHeight: 1.22,
                  color: "#0F172A",
                }}
              >
                {leftItems[row] ?? ""}
              </div>
            ))}
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
            }}
          >
            <AccentBadge label="VS" tone="info" />
            {Array.from({ length: rows }, (_, row) => (
              <div
                key={`mid-${row}`}
                style={{
                  minHeight: 90,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: FONT_FAMILY.number,
                  fontSize: TYPOGRAPHY.caption.fontSize - 4,
                  fontWeight: 700,
                  color: withAlpha("#0F172A", 0.42),
                }}
              >
                {row + 1}
              </div>
            ))}
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <AccentBadge label={rightLabel} tone="positive" />
            {Array.from({ length: rows }, (_, row) => (
              <div
                key={`right-${row}`}
                style={{
                  minHeight: 90,
                  padding: "16px 16px 14px",
                  borderRadius: BORDER_RADIUS.md,
                  background: "rgba(255,255,255,0.78)",
                  border: `1px solid ${withAlpha("#16A34A", 0.2)}`,
                  display: "flex",
                  alignItems: "center",
                  fontFamily: FONT_FAMILY.sans,
                  fontSize: TYPOGRAPHY.caption.fontSize + 2,
                  fontWeight: 700,
                  lineHeight: 1.22,
                  color: "#0F172A",
                }}
              >
                {rightItems[row] ?? ""}
              </div>
            ))}
          </div>
        </div>

      </TemplatePanel>
    </TemplateStage>
  );
};
