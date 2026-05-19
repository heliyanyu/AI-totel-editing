// SVU04 - presentation_family: suspense_talk
// one_screen_message: "听完再决定买不买"

import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

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
  hookCard: { x: 70, y: 270, w: 850, h: 420 },
  keywordRow: { x: 90, y: 760, w: 800, h: 300 },
  presenterLeftBottom: { x: 30, y: 1370, w: 280, h: 340 },
  subtitleBand: { x: 44, y: 1490, w: 850, h: 130 },
  platformTitle: { x: 0, y: 1788, w: 1080, h: 132 },
  rightRail: { x: 940, y: 1100, w: 140, h: 600 },
} satisfies Record<string, SlotRect>;

const beats = [
  { id: "setup", start: 0, end: 78, label: "悬念" },
  { id: "lock", start: 78, end: 175, label: "决定" },
] as const;

const subtitles: SubtitleCue[] = [
  { start: 0, end: 58, text: "听完你再决定", highlight: "听完" },
  { start: 58, end: 114, text: "这个钱\n还花不花", highlight: "花不花" },
  { start: 114, end: 175, text: "先别急着买", highlight: "别急" },
];

const HookCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = spring({
    frame: Math.max(0, frame - 6),
    fps,
    config: SPRINGS.enter,
    durationInFrames: 28,
  });
  const shine = interpolate(frame, [70, 130], [-260, 860], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        ...rectStyle(slots.hookCard),
        zIndex: 10,
        transform: `translateY(${(1 - t) * 36}px)`,
        opacity: interpolate(frame, [0, 14], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      }}
    >
      <div
        style={{
          height: "100%",
          borderRadius: 28,
          background: COLORS.paper,
          border: `4px solid ${COLORS.blueDeep}`,
          boxShadow: "0 26px 60px rgba(37,99,235,0.2)",
          display: "grid",
          placeItems: "center",
          overflow: "hidden",
          position: "relative",
          fontFamily: FONTS.sans,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: shine,
            top: -80,
            width: 150,
            height: 620,
            background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.8), transparent)",
            transform: "rotate(16deg)",
          }}
        />
        <div style={{ fontSize: 48, fontWeight: 850, color: COLORS.inkSoft, marginBottom: 6 }}>
          买之前先停一下
        </div>
        <div
          style={{
            fontSize: 86,
            fontWeight: 950,
            color: COLORS.ink,
            letterSpacing: 2,
            lineHeight: 1.08,
            textAlign: "center",
          }}
        >
          听完再决定<br />
          <span style={{ color: COLORS.blueDeep }}>买不买</span>
        </div>
      </div>
    </div>
  );
};

const KeywordRow: React.FC = () => {
  const frame = useCurrentFrame();
  const words = [
    { text: "鱼油", color: COLORS.blueDeep },
    { text: "牛初乳", color: COLORS.amber },
    { text: "灵芝粉", color: COLORS.purple },
  ];
  return (
    <div
      style={{
        ...rectStyle(slots.keywordRow),
        zIndex: 9,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: 22,
        fontFamily: FONTS.sans,
      }}
    >
      {words.map((item, i) => (
        <PopIn key={item.text} startFrame={64 + i * 12} springConfig={SPRINGS.pop}>
          <div
            style={{
              minWidth: 210,
              height: 116,
              borderRadius: 18,
              background: "rgba(255,255,255,0.82)",
              border: `3px solid ${item.color}`,
              boxShadow: `0 14px 30px ${item.color}22`,
              display: "grid",
              placeItems: "center",
              color: item.color,
              fontSize: 42,
              fontWeight: 950,
              opacity: frame > 140 ? 0.82 : 1,
            }}
          >
            {item.text}
          </div>
        </PopIn>
      ))}
    </div>
  );
};

export const SVU04PlanDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const active = beats.find((b) => isBetween(frame, b.start, b.end))?.id;
  return (
    <AbsoluteFill style={{ background: COLORS.bg, overflow: "hidden" }}>
      <PageBackground />
      <ProgressStrip
        slot={slots.topProgress}
        beats={beats}
        activeBeatId={active}
        beatColor={COLORS.amber}
        activeChapter="开场"
      />
      <HookCard />
      <KeywordRow />
      <Presenter slot={slots.presenterLeftBottom} frame={frame} size="small" />
      <RealSubtitle slot={slots.subtitleBand} cues={subtitles} frame={frame} />
      <PlatformChrome rightRail={slots.rightRail} platformTitle={slots.platformTitle} />
    </AbsoluteFill>
  );
};
