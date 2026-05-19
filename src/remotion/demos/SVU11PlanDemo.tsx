// SVU11 - presentation_family: mechanism_chain
// one_screen_message: "外壳消化不了"

import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

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
  chain: { x: 48, y: 250, w: 870, h: 980 },
  presenterLeftBottom: { x: 30, y: 1370, w: 280, h: 340 },
  subtitleBand: { x: 44, y: 1490, w: 850, h: 130 },
  platformTitle: { x: 0, y: 1788, w: 1080, h: 132 },
  rightRail: { x: 940, y: 1100, w: 140, h: 600 },
} satisfies Record<string, SlotRect>;

const beats = [
  { id: "shell", start: 0, end: 110, label: "外壳" },
  { id: "chitin", start: 110, end: 220, label: "几丁质" },
  { id: "human", start: 220, end: 338, label: "消化不了" },
] as const;

const subtitles: SubtitleCue[] = [
  { start: 0, end: 104, text: "灵芝孢子粉\n关键在外面那层壳", highlight: "外面那层壳" },
  { start: 104, end: 210, text: "那层壳主要是\n几丁质", highlight: "几丁质" },
  { start: 210, end: 338, text: "而人体\n基本消化不了", highlight: "消化不了" },
];

const ChainNode: React.FC<{
  frame: number;
  start: number;
  x: number;
  y: number;
  emoji: string;
  title: string;
  note: string;
  color: string;
}> = ({ frame, start, x, y, emoji, title, note, color }) => (
  <PopIn startFrame={start} springConfig={SPRINGS.enter}>
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 250,
        height: 280,
        borderRadius: 24,
        background: COLORS.paper,
        border: `4px solid ${color}`,
        boxShadow: `0 18px 42px ${color}24`,
        display: "grid",
        placeItems: "center",
        textAlign: "center",
        fontFamily: FONTS.sans,
        opacity: frame > start ? 1 : 0,
      }}
    >
      <div style={{ fontSize: 82 }}>{emoji}</div>
      <div style={{ fontSize: 38, fontWeight: 950, color }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: COLORS.inkSoft }}>{note}</div>
    </div>
  </PopIn>
);

const Arrow: React.FC<{ start: number; x1: number; y1: number; x2: number; y2: number }> = ({
  start,
  x1,
  y1,
  x2,
  y2,
}) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [start, start + 34], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  if (frame < start) return null;
  return (
    <svg width={870} height={980} style={{ position: "absolute", inset: 0, zIndex: 7 }}>
      <line
        x1={x1}
        y1={y1}
        x2={x1 + (x2 - x1) * t}
        y2={y1 + (y2 - y1) * t}
        stroke={COLORS.ink}
        strokeWidth={7}
        strokeLinecap="round"
      />
      <polygon points={`${x2 - 14},${y2 - 12} ${x2 + 16},${y2} ${x2 - 14},${y2 + 12}`} fill={COLORS.ink} />
    </svg>
  );
};

const Verdict: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < 236) return null;
  return (
    <PopIn startFrame={236} springConfig={SPRINGS.pop}>
      <div
        style={{
          position: "absolute",
          left: 80,
          top: 760,
          width: 720,
          height: 170,
          borderRadius: 22,
          background: COLORS.red,
          color: "white",
          display: "grid",
          placeItems: "center",
          fontFamily: FONTS.sans,
          fontSize: 62,
          fontWeight: 950,
          boxShadow: "0 18px 42px rgba(220,38,38,0.28)",
          zIndex: 14,
        }}
      >
        外壳消化不了
      </div>
    </PopIn>
  );
};

export const SVU11PlanDemo: React.FC = () => {
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
      <div style={{ ...rectStyle(slots.chain), zIndex: 4 }}>
        <ChainNode frame={frame} start={8} x={20} y={170} emoji="🍄" title="孢子外壳" note="看着像营养点" color={COLORS.purple} />
        <Arrow start={92} x1={280} y1={310} x2={365} y2={310} />
        <ChainNode frame={frame} start={112} x={360} y={170} emoji="🧱" title="几丁质" note="硬壳材料" color={COLORS.amber} />
        <Arrow start={200} x1={620} y1={310} x2={705} y2={310} />
        <ChainNode frame={frame} start={220} x={700} y={170} emoji="🚫" title="人体" note="缺少对应酶" color={COLORS.red} />
        <Verdict />
      </div>
      <Presenter slot={slots.presenterLeftBottom} frame={frame} size="small" />
      <RealSubtitle slot={slots.subtitleBand} cues={subtitles} frame={frame} />
      <PlatformChrome rightRail={slots.rightRail} platformTitle={slots.platformTitle} />
    </AbsoluteFill>
  );
};
