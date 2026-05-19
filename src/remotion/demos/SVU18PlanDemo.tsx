// SVU18 - presentation_family: mechanism_warning
// one_screen_message: "睡觉，是免疫系统修复期"

import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";

import { PopIn, SPRINGS } from "./motion-primitives";
import {
  COLORS,
  FONTS,
  PageBackground,
  PlatformChrome,
  Presenter,
  ProgressStrip,
  RealSubtitle,
  type SlotRect,
  type SubtitleCue,
  isBetween,
  rectStyle,
} from "./plan-shared";

const slots = {
  topProgress: { x: 28, y: 28, w: 1024, h: 114 },
  stage: { x: 54, y: 240, w: 860, h: 1040 },
  presenterLeftBottom: { x: 30, y: 1370, w: 280, h: 340 },
  subtitleBand: { x: 44, y: 1490, w: 850, h: 130 },
  platformTitle: { x: 0, y: 1788, w: 1080, h: 132 },
  rightRail: { x: 940, y: 1100, w: 140, h: 600 },
} satisfies Record<string, SlotRect>;

const beats = [
  { id: "repair", start: 0, end: 160, label: "修复" },
  { id: "night", start: 160, end: 260, label: "熬夜" },
  { id: "warning", start: 260, end: 341, label: "警示" },
] as const;

const subtitles: SubtitleCue[] = [
  { start: 0, end: 110, text: "第三件\n就是好好睡觉", highlight: "好好睡觉" },
  { start: 110, end: 210, text: "睡觉的时候\n免疫系统在修复", highlight: "修复" },
  { start: 210, end: 341, text: "熬夜就是\n打断修复", highlight: "打断修复" },
];

const RepairArc: React.FC = () => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [28, 170], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  return (
    <div style={{ ...rectStyle(slots.stage), zIndex: 7, fontFamily: FONTS.sans }}>
      <PopIn startFrame={8} springConfig={SPRINGS.enter}>
        <div
          style={{
            position: "absolute",
            left: 130,
            top: 130,
            width: 620,
            height: 520,
            borderRadius: 32,
            background: COLORS.paper,
            border: `4px solid ${COLORS.blueDeep}`,
            boxShadow: "0 24px 58px rgba(37,99,235,0.18)",
            display: "grid",
            placeItems: "center",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 120 }}>🌙</div>
          <div style={{ fontSize: 54, fontWeight: 950, color: COLORS.ink }}>睡觉 = 修复期</div>
          <div style={{ width: 460, height: 24, borderRadius: 999, background: "#E2E8F0", marginTop: 20 }}>
            <div
              style={{
                width: `${progress * 100}%`,
                height: "100%",
                borderRadius: 999,
                background: COLORS.green,
              }}
            />
          </div>
          <div style={{ fontSize: 24, fontWeight: 850, color: COLORS.inkSoft, marginTop: 8 }}>
            免疫系统夜间维护中
          </div>
        </div>
      </PopIn>
    </div>
  );
};

const LateNightBreak: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < 180) return null;
  const slash = interpolate(frame, [200, 238], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div style={{ ...rectStyle(slots.stage), zIndex: 14 }}>
      <PopIn startFrame={180} springConfig={SPRINGS.pop}>
        <div
          style={{
            position: "absolute",
            right: 80,
            top: 620,
            width: 340,
            height: 210,
            borderRadius: 24,
            background: COLORS.red,
            color: "white",
            display: "grid",
            placeItems: "center",
            textAlign: "center",
            fontFamily: FONTS.sans,
            fontSize: 42,
            fontWeight: 950,
            boxShadow: "0 18px 42px rgba(220,38,38,0.28)",
          }}
        >
          熬夜<br />打断修复
        </div>
      </PopIn>
      <svg width={860} height={1040} style={{ position: "absolute", inset: 0 }}>
        <line
          x1={210}
          y1={250}
          x2={210 + 470 * slash}
          y2={250 + 390 * slash}
          stroke={COLORS.red}
          strokeWidth={22}
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
};

export const SVU18PlanDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const active = beats.find((b) => isBetween(frame, b.start, b.end))?.id;
  return (
    <AbsoluteFill style={{ background: COLORS.bg, overflow: "hidden" }}>
      <PageBackground />
      <ProgressStrip slot={slots.topProgress} beats={beats} activeBeatId={active} beatColor={COLORS.blueDeep} activeChapter="三件事" />
      <RepairArc />
      <LateNightBreak />
      <Presenter slot={slots.presenterLeftBottom} frame={frame} size="small" />
      <RealSubtitle slot={slots.subtitleBand} cues={subtitles} frame={frame} />
      <PlatformChrome rightRail={slots.rightRail} platformTitle={slots.platformTitle} />
    </AbsoluteFill>
  );
};
