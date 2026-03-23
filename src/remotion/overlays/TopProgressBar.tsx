import React, { useMemo } from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  BACKGROUND,
  BORDER_RADIUS,
  FONT_FAMILY,
  SEMANTIC_COLORS,
  SHADOWS,
  TYPOGRAPHY,
  withAlpha,
} from "../design-system";
import { SCENE_TONE } from "../visual-language";
import type { VisualSegmentPlan, VisualTopicNode } from "../../compose/visual-planner";

interface TopProgressBarProps {
  segments: VisualSegmentPlan[];
  nodes: VisualTopicNode[];
}

type NodeState = "pending" | "active" | "completed";

export const PROGRESS_BAR_TOP = 78;
export const PROGRESS_BAR_HEIGHT = 72;

const VIDEO_W = 1080;
const CHIP_GAP = 8;
const CHIP_PADDING_H = 24;
const INDICATOR_W = 28;
const CONNECTOR_W = 16 + CHIP_GAP * 2;
const FONT_SIZE = 28;

function getActiveSegment(frame: number, segments: VisualSegmentPlan[]): VisualSegmentPlan | null {
  for (const segment of segments) {
    const end = segment.fromFrame + segment.contentDurationInFrames;
    if (frame >= segment.fromFrame && frame <= end) {
      return segment;
    }
  }
  return segments[0] ?? null;
}

function getNodeStates(
  activeTopicId: string | null,
  nodes: VisualTopicNode[]
): Map<string, NodeState> {
  const states = new Map<string, NodeState>();
  const activeIndex = nodes.findIndex((node) => node.id === activeTopicId);

  for (let index = 0; index < nodes.length; index++) {
    if (activeIndex === -1 || index > activeIndex) {
      states.set(nodes[index].id, "pending");
    } else if (index < activeIndex) {
      states.set(nodes[index].id, "completed");
    } else {
      states.set(nodes[index].id, "active");
    }
  }

  return states;
}

// ========== Chip sub-component ==========

const Chip: React.FC<{
  label: string;
  index: number;
  state: NodeState;
  toneColor: string;
  breatheScale: number;
  compact?: boolean;
}> = ({ label, index, state, toneColor, breatheScale, compact }) => {
  let bg: string;
  let textColor: string;
  let fontWeight: number;
  let border: string;
  let indicatorBg: string;
  let indicatorContent: React.ReactNode;

  if (state === "active") {
    bg = toneColor;
    textColor = "#FFFFFF";
    fontWeight = 650;
    border = `1.5px solid ${toneColor}`;
    indicatorBg = "rgba(255,255,255,0.30)";
    indicatorContent = (
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: "#FFFFFF",
          display: "inline-block",
        }}
      />
    );
  } else if (state === "completed") {
    bg = "rgba(255, 255, 255, 0.96)";
    textColor = withAlpha("#0F172A", 0.88);
    fontWeight = 500;
    border = `1.5px solid ${withAlpha(SEMANTIC_COLORS.positive, 0.4)}`;
    indicatorBg = SEMANTIC_COLORS.positive;
    indicatorContent = (
      <svg width={12} height={12} viewBox="0 0 24 24" fill="none">
        <path
          d="M6 13 L10.5 17.5 L18 8"
          stroke="#FFFFFF"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  } else {
    bg = "rgba(255, 255, 255, 0.72)";
    textColor = withAlpha("#0F172A", 0.5);
    fontWeight = 400;
    border = `1.5px solid ${withAlpha("#0F172A", 0.1)}`;
    indicatorBg = withAlpha("#0F172A", 0.08);
    indicatorContent = (
      <span
        style={{
          fontSize: 12,
          color: withAlpha("#0F172A", 0.45),
          fontWeight: 600,
          fontFamily: FONT_FAMILY.sans,
        }}
      >
        {index + 1}
      </span>
    );
  }

  const fontSize = compact ? 24 : FONT_SIZE;
  const chipPadding = compact ? "8px 14px 8px 10px" : "9px 18px 9px 12px";
  const indicatorSize = compact ? 22 : 26;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: compact ? 5 : 6,
        padding: chipPadding,
        borderRadius: BORDER_RADIUS.md,
        background: bg,
        border,
        transform: `scale(${breatheScale})`,
        willChange: "transform",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: indicatorSize,
          height: indicatorSize,
          borderRadius: "50%",
          background: indicatorBg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {indicatorContent}
      </div>

      <span
        style={{
          color: textColor,
          fontSize,
          fontWeight,
          fontFamily: FONT_FAMILY.sans,
          whiteSpace: "nowrap",
          lineHeight: 1.2,
        }}
      >
        {label}
      </span>
    </div>
  );
};

// ========== Connector sub-component ==========

const Connector: React.FC<{
  prevState: NodeState;
}> = ({ prevState }) => {
  const color =
    prevState === "completed"
      ? withAlpha(SEMANTIC_COLORS.positive, 0.5)
      : withAlpha("#0F172A", 0.12);

  return (
    <div
      style={{
        width: 14,
        height: 2,
        borderRadius: 1,
        background: color,
        flexShrink: 0,
      }}
    />
  );
};

// ========== Main Component ==========

export const TopProgressBar: React.FC<TopProgressBarProps> = ({
  segments,
  nodes,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const activeSegment = useMemo(() => getActiveSegment(frame, segments), [frame, segments]);

  if (!activeSegment || nodes.length === 0) {
    return null;
  }

  const nodeStates = getNodeStates(activeSegment.topicId, nodes);
  const tone = SCENE_TONE[activeSegment.tone];

  const entry = spring({
    frame,
    fps,
    config: { mass: 1, damping: 16, stiffness: 100 },
    durationInFrames: 24,
  });

  const translateY = interpolate(entry, [0, 1], [-(PROGRESS_BAR_HEIGHT + PROGRESS_BAR_TOP), 0]);
  const entryOpacity = interpolate(entry, [0, 0.4, 1], [0, 0.5, 1]);

  // Breathing scale for active chip
  const breathePeriod = (1200 / 1000) * fps;
  const breathePhase = (frame % breathePeriod) / breathePeriod;
  const breatheScale = 1 + 0.008 * Math.sin(breathePhase * Math.PI * 2);

  // Calculate chip widths for scroll logic
  const chipWidths = nodes.map((n) => {
    const textW = n.label.length * FONT_SIZE * 0.95;
    return textW + CHIP_PADDING_H + INDICATOR_W;
  });
  const totalContentW =
    chipWidths.reduce((sum, width) => sum + width, 0) +
    (nodes.length - 1) * CONNECTOR_W;

  const needsScroll = totalContentW > VIDEO_W - 32;
  const activeIdx = [...nodeStates.entries()].findIndex(([, state]) => state === "active");

  let scrollX = 0;
  if (needsScroll && activeIdx >= 0) {
    let centerX = 0;
    for (let i = 0; i < activeIdx; i++) {
      centerX += chipWidths[i] + CONNECTOR_W;
    }
    centerX += chipWidths[activeIdx] / 2;

    scrollX = VIDEO_W / 2 - centerX;
    const maxScroll = 0;
    const minScroll = VIDEO_W - totalContentW - 16;
    scrollX = Math.max(minScroll, Math.min(maxScroll, scrollX));
  }

  const finalScrollX = needsScroll ? scrollX : 0;

  return (
    <AbsoluteFill
      style={{
        top: PROGRESS_BAR_TOP,
        left: 0,
        width: "100%",
        height: PROGRESS_BAR_HEIGHT,
        bottom: "auto",
        pointerEvents: "none",
        opacity: entryOpacity,
        transform: `translateY(${translateY}px)`,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(255, 255, 255, 0.84)",
          borderBottom: `1px solid ${withAlpha("#0F172A", 0.08)}`,
          backdropFilter: `blur(${BACKGROUND.glassBlur}px)`,
        }}
      />

      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            height: "100%",
            gap: CHIP_GAP,
            paddingLeft: needsScroll ? 16 : 0,
            justifyContent: needsScroll ? "flex-start" : "center",
            transform: needsScroll ? `translateX(${finalScrollX}px)` : undefined,
            transition: "transform 0.3s ease-out",
            willChange: needsScroll ? "transform" : undefined,
          }}
        >
          {nodes.map((node, idx) => {
            const state = nodeStates.get(node.id) || "pending";
            return (
              <React.Fragment key={node.id}>
                {idx > 0 && (
                  <Connector
                    prevState={nodeStates.get(nodes[idx - 1].id) || "pending"}
                  />
                )}
                <Chip
                  label={node.label}
                  index={idx}
                  state={state}
                  toneColor={tone.solid}
                  breatheScale={state === "active" ? breatheScale : 1}
                  compact={needsScroll}
                />
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
