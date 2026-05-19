// SVU16 - presentation_family: action_path
// one_screen_message: "每天晒十来分钟"

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
  path: { x: 52, y: 240, w: 860, h: 1040 },
  presenterLeftBottom: { x: 30, y: 1370, w: 280, h: 340 },
  subtitleBand: { x: 44, y: 1490, w: 850, h: 130 },
  platformTitle: { x: 0, y: 1788, w: 1080, h: 132 },
  rightRail: { x: 940, y: 1100, w: 140, h: 600 },
} satisfies Record<string, SlotRect>;

const beats = [
  { id: "sun", start: 0, end: 170, label: "晒太阳" },
  { id: "branch", start: 170, end: 330, label: "条件" },
  { id: "supp", start: 330, end: 490, label: "补剂" },
] as const;

const subtitles: SubtitleCue[] = [
  { start: 0, end: 118, text: "第一件\n每天晒十来分钟太阳", highlight: "晒十来分钟" },
  { start: 118, end: 248, text: "维生素D\n主要靠晒太阳", highlight: "维生素D" },
  { start: 248, end: 370, text: "冬天晒不到\n再考虑补剂", highlight: "晒不到" },
  { start: 370, end: 490, text: "不是一上来\n就买一堆", highlight: "不是" },
];

const PathLine: React.FC = () => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [40, 360], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const points = [
    [170, 250],
    [430, 250],
    [690, 250],
    [690, 580],
  ];
  return (
    <svg width={860} height={1040} style={{ position: "absolute", inset: 0, zIndex: 6 }}>
      <path
        d={`M ${points[0][0]} ${points[0][1]} L ${points[1][0]} ${points[1][1]} L ${points[2][0]} ${points[2][1]} L ${points[3][0]} ${points[3][1]}`}
        fill="none"
        stroke={COLORS.line}
        strokeWidth={18}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={`M ${points[0][0]} ${points[0][1]} L ${points[1][0]} ${points[1][1]} L ${points[2][0]} ${points[2][1]} L ${points[3][0]} ${points[3][1]}`}
        fill="none"
        stroke={COLORS.amber}
        strokeWidth={18}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={900}
        strokeDashoffset={900 * (1 - progress)}
      />
    </svg>
  );
};

const Step: React.FC<{ start: number; x: number; y: number; emoji: string; title: string; note: string; color: string }> = ({
  start,
  x,
  y,
  emoji,
  title,
  note,
  color,
}) => (
  <PopIn startFrame={start} springConfig={SPRINGS.enter}>
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 230,
        height: 220,
        borderRadius: 24,
        background: COLORS.paper,
        border: `4px solid ${color}`,
        boxShadow: `0 16px 38px ${color}22`,
        display: "grid",
        placeItems: "center",
        textAlign: "center",
        fontFamily: FONTS.sans,
        zIndex: 9,
      }}
    >
      <div style={{ fontSize: 72 }}>{emoji}</div>
      <div style={{ fontSize: 32, fontWeight: 950, color }}>{title}</div>
      <div style={{ fontSize: 20, fontWeight: 850, color: COLORS.inkSoft }}>{note}</div>
    </div>
  </PopIn>
);

const MainRule: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < 90) return null;
  return (
    <PopIn startFrame={90} springConfig={SPRINGS.pop}>
      <div
        style={{
          position: "absolute",
          left: 90,
          top: 790,
          width: 720,
          height: 150,
          borderRadius: 18,
          background: COLORS.amber,
          color: "white",
          display: "grid",
          placeItems: "center",
          fontFamily: FONTS.sans,
          fontSize: 58,
          fontWeight: 950,
          boxShadow: "0 18px 42px rgba(245,158,11,0.28)",
          zIndex: 14,
        }}
      >
        每天晒十来分钟
      </div>
    </PopIn>
  );
};

export const SVU16PlanDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const active = beats.find((b) => isBetween(frame, b.start, b.end))?.id;
  return (
    <AbsoluteFill style={{ background: COLORS.bg, overflow: "hidden" }}>
      <PageBackground />
      <ProgressStrip slot={slots.topProgress} beats={beats} activeBeatId={active} beatColor={COLORS.amber} activeChapter="三件事" />
      <div style={{ ...rectStyle(slots.path), zIndex: 4 }}>
        <PathLine />
        <Step start={10} x={60} y={140} emoji="☀️" title="太阳" note="优先来源" color={COLORS.amber} />
        <Step start={120} x={320} y={140} emoji="🦴" title="维生素D" note="身体合成" color={COLORS.blueDeep} />
        <Step start={210} x={580} y={140} emoji="🌧️" title="晒不到" note="冬天/室内" color={COLORS.inkSoft} />
        <Step start={330} x={580} y={470} emoji="💊" title="再补剂" note="作为备选" color={COLORS.green} />
        <MainRule />
      </div>
      <Presenter slot={slots.presenterLeftBottom} frame={frame} size="small" />
      <RealSubtitle slot={slots.subtitleBand} cues={subtitles} frame={frame} />
      <PlatformChrome rightRail={slots.rightRail} platformTitle={slots.platformTitle} />
    </AbsoluteFill>
  );
};
