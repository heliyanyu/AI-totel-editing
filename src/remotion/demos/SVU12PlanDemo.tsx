// SVU12 - presentation_family: myth_flip
// one_screen_message: "破了壳，也氧化了"

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
  stage: { x: 52, y: 250, w: 860, h: 980 },
  presenterLeftBottom: { x: 30, y: 1370, w: 280, h: 340 },
  subtitleBand: { x: 44, y: 1490, w: 850, h: 130 },
  platformTitle: { x: 0, y: 1788, w: 1080, h: 132 },
  rightRail: { x: 940, y: 1100, w: 140, h: 600 },
} satisfies Record<string, SlotRect>;

const beats = [
  { id: "myth", start: 0, end: 88, label: "误区" },
  { id: "crack", start: 88, end: 156, label: "破壁" },
  { id: "flip", start: 156, end: 228, label: "翻转" },
] as const;

const subtitles: SubtitleCue[] = [
  { start: 0, end: 82, text: "有人说\n它不是破壁了吗", highlight: "破壁" },
  { start: 82, end: 156, text: "破是破了", highlight: "破" },
  { start: 156, end: 228, text: "但释放出来\n也更容易氧化变质", highlight: "氧化变质" },
];

const FlipCard: React.FC = () => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [132, 176], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
  const showBack = t > 0.5;
  return (
    <div
      style={{
        position: "absolute",
        left: 120,
        top: 300,
        width: 660,
        height: 520,
        transform: `rotateY(${t * 180}deg)`,
        transformStyle: "preserve-3d",
        zIndex: 10,
        fontFamily: FONTS.sans,
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 32,
          background: COLORS.paper,
          border: `5px solid ${showBack ? COLORS.red : COLORS.purple}`,
          boxShadow: "0 28px 64px rgba(15,23,42,0.18)",
          display: "grid",
          placeItems: "center",
          textAlign: "center",
          transform: showBack ? "rotateY(180deg)" : undefined,
          padding: 32,
        }}
      >
        {showBack ? (
          <>
            <div style={{ fontSize: 104 }}>🧪</div>
            <div style={{ fontSize: 76, fontWeight: 950, color: COLORS.red }}>也氧化了</div>
            <div style={{ fontSize: 30, color: COLORS.inkSoft, fontWeight: 850 }}>释放 ≠ 稳定有效</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 112 }}>🔨</div>
            <div style={{ fontSize: 76, fontWeight: 950, color: COLORS.purple }}>破壁就吸收？</div>
            <div style={{ fontSize: 30, color: COLORS.inkSoft, fontWeight: 850 }}>常见卖点</div>
          </>
        )}
      </div>
    </div>
  );
};

const CrackLines: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < 88 || frame > 156) return null;
  const t = interpolate(frame, [88, 124], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <svg width={860} height={980} style={{ position: "absolute", inset: 0, zIndex: 13 }}>
      {[0, 1, 2].map((i) => (
        <line
          key={i}
          x1={420}
          y1={460}
          x2={420 + (i - 1) * 170 * t}
          y2={460 + (i === 1 ? -190 : 120) * t}
          stroke="white"
          strokeWidth={9}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
};

const BottomVerdict: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < 168) return null;
  return (
    <PopIn startFrame={168} springConfig={SPRINGS.pop}>
      <div
        style={{
          position: "absolute",
          left: 90,
          top: 900,
          width: 720,
          height: 120,
          borderRadius: 18,
          background: COLORS.red,
          color: "white",
          display: "grid",
          placeItems: "center",
          fontFamily: FONTS.sans,
          fontSize: 50,
          fontWeight: 950,
          zIndex: 16,
        }}
      >
        破了壳，也氧化了
      </div>
    </PopIn>
  );
};

export const SVU12PlanDemo: React.FC = () => {
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
        <FlipCard />
        <CrackLines />
        <BottomVerdict />
      </div>
      <Presenter slot={slots.presenterLeftBottom} frame={frame} size="small" />
      <RealSubtitle slot={slots.subtitleBand} cues={subtitles} frame={frame} />
      <PlatformChrome rightRail={slots.rightRail} platformTitle={slots.platformTitle} />
    </AbsoluteFill>
  );
};
