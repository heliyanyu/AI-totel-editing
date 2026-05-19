// SVU13 - presentation_family: replacement_compare
// one_screen_message: "真不如两个鸡蛋"

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
  left: { x: 58, y: 300, w: 390, h: 700 },
  right: { x: 510, y: 300, w: 390, h: 700 },
  verdict: { x: 78, y: 1060, w: 800, h: 150 },
  presenterLeftBottom: { x: 30, y: 1370, w: 280, h: 340 },
  subtitleBand: { x: 44, y: 1490, w: 850, h: 130 },
  platformTitle: { x: 0, y: 1788, w: 1080, h: 132 },
  rightRail: { x: 940, y: 1100, w: 140, h: 600 },
} satisfies Record<string, SlotRect>;

const beats = [
  { id: "expensive", start: 0, end: 82, label: "花几百" },
  { id: "replace", start: 82, end: 185, label: "替代" },
] as const;

const subtitles: SubtitleCue[] = [
  { start: 0, end: 78, text: "花几百块钱\n买这个", highlight: "几百块钱" },
  { start: 78, end: 185, text: "真不如\n吃两个鸡蛋", highlight: "两个鸡蛋" },
];

const CompareCard: React.FC<{
  slot: SlotRect;
  enter: number;
  emoji: string;
  title: string;
  note: string;
  color: string;
  dim?: boolean;
}> = ({ slot, enter, emoji, title, note, color, dim }) => {
  const frame = useCurrentFrame();
  const opacity = dim ? interpolate(frame, [82, 130], [1, 0.45], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  return (
    <PopIn startFrame={enter} springConfig={SPRINGS.enter}>
      <div
        style={{
          ...rectStyle(slot),
          zIndex: 9,
          opacity,
          borderRadius: 28,
          background: COLORS.paper,
          border: `4px solid ${color}`,
          boxShadow: `0 22px 50px ${color}22`,
          display: "grid",
          placeItems: "center",
          fontFamily: FONTS.sans,
          textAlign: "center",
          padding: 24,
        }}
      >
        <div style={{ fontSize: 154 }}>{emoji}</div>
        <div style={{ fontSize: 48, fontWeight: 950, color: COLORS.ink, lineHeight: 1.12 }}>
          {title}
        </div>
        <div style={{ fontSize: 30, fontWeight: 950, color, marginTop: 18 }}>{note}</div>
      </div>
    </PopIn>
  );
};

const Verdict: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < 100) return null;
  const sweep = interpolate(frame, [110, 155], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  return (
    <PopIn startFrame={100} springConfig={SPRINGS.pop}>
      <div
        style={{
          ...rectStyle(slots.verdict),
          zIndex: 14,
          borderRadius: 18,
          background: COLORS.green,
          color: "white",
          fontFamily: FONTS.sans,
          fontSize: 62,
          fontWeight: 950,
          display: "grid",
          placeItems: "center",
          boxShadow: "0 18px 42px rgba(22,163,74,0.3)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${sweep * 100}%`,
            background: "rgba(255,255,255,0.18)",
          }}
        />
        <span style={{ position: "relative" }}>真不如两个鸡蛋</span>
      </div>
    </PopIn>
  );
};

export const SVU13PlanDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const active = beats.find((b) => isBetween(frame, b.start, b.end))?.id;
  return (
    <AbsoluteFill style={{ background: COLORS.bg, overflow: "hidden" }}>
      <PageBackground />
      <ProgressStrip slot={slots.topProgress} beats={beats} activeBeatId={active} beatColor={COLORS.green} activeChapter="灵芝" />
      <CompareCard slot={slots.left} enter={6} emoji="🍄" title="灵芝孢子粉" note="几百块起步" color={COLORS.purple} dim />
      <CompareCard slot={slots.right} enter={74} emoji="🥚🥚" title="两个鸡蛋" note="朴素蛋白质" color={COLORS.green} />
      <Verdict />
      <Presenter slot={slots.presenterLeftBottom} frame={frame} size="small" />
      <RealSubtitle slot={slots.subtitleBand} cues={subtitles} frame={frame} />
      <PlatformChrome rightRail={slots.rightRail} platformTitle={slots.platformTitle} />
    </AbsoluteFill>
  );
};
