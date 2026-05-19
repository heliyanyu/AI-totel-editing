// SVU10 - presentation_family: object_shock_title
// one_screen_message: "灵芝孢子粉：智商税靠前"

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
  stage: { x: 58, y: 250, w: 860, h: 970 },
  presenterLeftBottom: { x: 30, y: 1370, w: 280, h: 340 },
  subtitleBand: { x: 44, y: 1490, w: 850, h: 130 },
  platformTitle: { x: 0, y: 1788, w: 1080, h: 132 },
  rightRail: { x: 940, y: 1100, w: 140, h: 600 },
} satisfies Record<string, SlotRect>;

const beats = [
  { id: "enter", start: 0, end: 88, label: "登场" },
  { id: "stamp", start: 88, end: 180, label: "定性" },
] as const;

const subtitles: SubtitleCue[] = [
  { start: 0, end: 82, text: "第三个\n灵芝孢子粉", highlight: "灵芝孢子粉" },
  { start: 82, end: 180, text: "在智商税榜单里\n位置很靠前", highlight: "智商税" },
];

const SporeJar: React.FC = () => {
  const frame = useCurrentFrame();
  const y = interpolate(frame, [0, 44], [180, 390], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.back(1.2)),
  });
  return (
    <div
      style={{
        position: "absolute",
        left: 330,
        top: y,
        width: 310,
        height: 420,
        borderRadius: 36,
        background: "linear-gradient(180deg, #FFFFFF 0%, #F5E8FF 100%)",
        border: `5px solid ${COLORS.purple}`,
        boxShadow: "0 26px 60px rgba(124,58,237,0.24)",
        display: "grid",
        placeItems: "center",
        fontFamily: FONTS.sans,
        transform: `rotate(${Math.sin(frame / 12) * 2}deg)`,
        zIndex: 9,
      }}
    >
      <div style={{ fontSize: 128 }}>🍄</div>
      <div style={{ fontSize: 42, fontWeight: 950, color: COLORS.purple }}>灵芝孢子粉</div>
      <div style={{ fontSize: 24, color: COLORS.inkSoft, fontWeight: 850 }}>高价包装</div>
    </div>
  );
};

const TaxStamp: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < 86) return null;
  return (
    <PopIn startFrame={86} springConfig={SPRINGS.pop}>
      <div
        style={{
          position: "absolute",
          left: 180,
          top: 770,
          width: 620,
          height: 190,
          borderRadius: 22,
          border: `8px solid ${COLORS.red}`,
          background: "rgba(254,226,226,0.92)",
          color: COLORS.red,
          display: "grid",
          placeItems: "center",
          fontFamily: FONTS.sans,
          fontSize: 72,
          fontWeight: 950,
          letterSpacing: 4,
          transform: "rotate(-5deg)",
          boxShadow: "0 18px 44px rgba(220,38,38,0.26)",
          zIndex: 15,
        }}
      >
        智商税靠前
      </div>
    </PopIn>
  );
};

export const SVU10PlanDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const active = beats.find((b) => isBetween(frame, b.start, b.end))?.id;
  return (
    <AbsoluteFill style={{ background: COLORS.bg, overflow: "hidden" }}>
      <PageBackground />
      <ProgressStrip
        slot={slots.topProgress}
        beats={beats}
        activeBeatId={active}
        beatColor={COLORS.purple}
        activeChapter="灵芝"
      />
      <div style={{ ...rectStyle(slots.stage), zIndex: 4 }}>
        <SporeJar />
        <TaxStamp />
      </div>
      <Presenter slot={slots.presenterLeftBottom} frame={frame} size="small" />
      <RealSubtitle slot={slots.subtitleBand} cues={subtitles} frame={frame} />
      <PlatformChrome rightRail={slots.rightRail} platformTitle={slots.platformTitle} />
    </AbsoluteFill>
  );
};
