// SVU06 - presentation_family: case_narrative
// one_screen_message: "心脏不好，别乱补鱼油"

import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";

import { CountUp, PopIn, SPRINGS } from "./motion-primitives";
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
  story: { x: 54, y: 230, w: 860, h: 1040 },
  presenterLeftBottom: { x: 30, y: 1370, w: 280, h: 340 },
  subtitleBand: { x: 44, y: 1490, w: 850, h: 130 },
  platformTitle: { x: 0, y: 1788, w: 1080, h: 132 },
  rightRail: { x: 940, y: 1100, w: 140, h: 600 },
} satisfies Record<string, SlotRect>;

const beats = [
  { id: "case", start: 0, end: 110, label: "案例" },
  { id: "reverse", start: 110, end: 224, label: "反效果" },
  { id: "warning", start: 224, end: 331, label: "警示" },
] as const;

const subtitles: SubtitleCue[] = [
  { start: 0, end: 92, text: "心脏不好\n就买鱼油补一补", highlight: "心脏不好" },
  { start: 92, end: 190, text: "结果补来补去\n房颤反而更频繁", highlight: "更频繁" },
  { start: 190, end: 331, text: "这类人\n别自己乱补", highlight: "别自己乱补" },
];

const PatientCard: React.FC = () => (
  <PopIn startFrame={8} springConfig={SPRINGS.enter}>
    <div
      style={{
        position: "absolute",
        left: 70,
        top: 290,
        width: 330,
        height: 420,
        borderRadius: 24,
        background: COLORS.paper,
        border: `3px solid ${COLORS.line}`,
        boxShadow: "0 18px 42px rgba(15,23,42,0.12)",
        display: "grid",
        placeItems: "center",
        fontFamily: FONTS.sans,
      }}
    >
      <div style={{ fontSize: 122 }}>🫀</div>
      <div style={{ fontSize: 36, fontWeight: 950, color: COLORS.ink }}>心脏不好</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: COLORS.inkSoft }}>想靠鱼油补一补</div>
    </div>
  </PopIn>
);

const FishOilBottle: React.FC = () => {
  const frame = useCurrentFrame();
  const x = interpolate(frame, [58, 132], [690, 430], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const y = interpolate(frame, [58, 132], [350, 508], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 190,
        height: 260,
        transform: "translate(-50%, -50%) rotate(-10deg)",
        zIndex: 12,
        borderRadius: 28,
        background: "linear-gradient(180deg, #FFFFFF, #DBEAFE)",
        border: `4px solid ${COLORS.blueDeep}`,
        boxShadow: "0 18px 42px rgba(37,99,235,0.24)",
        display: "grid",
        placeItems: "center",
        fontFamily: FONTS.sans,
        fontWeight: 950,
      }}
    >
      <div style={{ fontSize: 72 }}>🐟</div>
      <div style={{ fontSize: 32, color: COLORS.blueDeep }}>鱼油</div>
    </div>
  );
};

const EcgPanel: React.FC = () => {
  const frame = useCurrentFrame();
  const chaos = frame >= 138;
  const draw = interpolate(frame, [138, 210], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <PopIn startFrame={118} springConfig={SPRINGS.enter}>
      <div
        style={{
          position: "absolute",
          left: 470,
          top: 720,
          width: 390,
          height: 300,
          borderRadius: 22,
          background: COLORS.paper,
          border: `4px solid ${chaos ? COLORS.red : COLORS.green}`,
          boxShadow: `0 18px 42px ${chaos ? "rgba(220,38,38,0.2)" : "rgba(22,163,74,0.16)"}`,
          padding: 26,
          fontFamily: FONTS.sans,
        }}
      >
        <div style={{ fontSize: 28, fontWeight: 950, color: chaos ? COLORS.red : COLORS.green }}>
          房颤频率
        </div>
        <svg width={330} height={120} viewBox="0 0 330 120" style={{ marginTop: 20 }}>
          <path
            d={
              chaos
                ? "M0 62 L24 62 L34 20 L42 102 L52 38 L66 85 L78 26 L92 96 L104 44 L120 62 L160 62 L176 18 L186 108 L200 42 L214 88 L230 30 L246 62 L330 62"
                : "M0 62 L68 62 L84 20 L100 98 L118 62 L190 62 L206 20 L222 98 L240 62 L330 62"
            }
            fill="none"
            stroke={chaos ? COLORS.red : COLORS.green}
            strokeWidth={8}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={720}
            strokeDashoffset={720 * (1 - draw)}
          />
        </svg>
        <div style={{ fontSize: 44, fontWeight: 950, color: COLORS.red }}>
          +<CountUp startFrame={210} durationFrames={32} to={3} /> 次
        </div>
      </div>
    </PopIn>
  );
};

const WarningBanner: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < 224) return null;
  return (
    <PopIn startFrame={224} springConfig={SPRINGS.pop}>
      <div
        style={{
          position: "absolute",
          left: 68,
          top: 1070,
          width: 790,
          height: 120,
          borderRadius: 18,
          background: COLORS.red,
          color: "white",
          display: "grid",
          placeItems: "center",
          fontFamily: FONTS.sans,
          fontSize: 46,
          fontWeight: 950,
          boxShadow: "0 18px 40px rgba(220,38,38,0.32)",
        }}
      >
        心脏不好，别自己乱补鱼油
      </div>
    </PopIn>
  );
};

export const SVU06PlanDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const active = beats.find((b) => isBetween(frame, b.start, b.end))?.id;
  return (
    <AbsoluteFill style={{ background: COLORS.bg, overflow: "hidden" }}>
      <PageBackground />
      <ProgressStrip
        slot={slots.topProgress}
        beats={beats}
        activeBeatId={active}
        beatColor={COLORS.red}
        activeChapter="鱼油"
      />
      <div style={{ ...rectStyle(slots.story), zIndex: 4 }}>
        <PatientCard />
        <FishOilBottle />
        <EcgPanel />
        <WarningBanner />
      </div>
      <Presenter slot={slots.presenterLeftBottom} frame={frame} size="small" />
      <RealSubtitle slot={slots.subtitleBand} cues={subtitles} frame={frame} />
      <PlatformChrome rightRail={slots.rightRail} platformTitle={slots.platformTitle} />
    </AbsoluteFill>
  );
};
