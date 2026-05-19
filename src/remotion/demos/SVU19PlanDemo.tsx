// SVU19 - presentation_family: value_summary
// one_screen_message: "省下钱，买真实食物"

import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";

import { PopIn, SPRINGS, StackReveal } from "./motion-primitives";
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
  stage: { x: 46, y: 240, w: 870, h: 1040 },
  presenterLeftBottom: { x: 30, y: 1370, w: 280, h: 340 },
  subtitleBand: { x: 44, y: 1490, w: 850, h: 130 },
  platformTitle: { x: 0, y: 1788, w: 1080, h: 132 },
  rightRail: { x: 940, y: 1100, w: 140, h: 600 },
} satisfies Record<string, SlotRect>;

const beats = [
  { id: "three", start: 0, end: 180, label: "三件事" },
  { id: "money", start: 180, end: 514, label: "钱去哪" },
] as const;

const subtitles: SubtitleCue[] = [
  { start: 0, end: 120, text: "这三样\n没有一样要花大钱", highlight: "不花大钱" },
  { start: 120, end: 260, text: "真正有用的\n往往很朴实", highlight: "朴实" },
  { start: 260, end: 390, text: "省下来的钱\n买鱼虾水果", highlight: "鱼虾水果" },
  { start: 390, end: 514, text: "给家人吃顿好的\n比啥都强", highlight: "家人" },
];

const ActionRecap: React.FC = () => {
  const items = [
    { emoji: "☀️", title: "晒太阳" },
    { emoji: "🚶", title: "动起来" },
    { emoji: "🌙", title: "早点睡" },
  ];
  return (
    <div style={{ position: "absolute", left: 60, top: 150, width: 760, zIndex: 9 }}>
      <StackReveal startFrame={16} staggerFrames={22} slideFrom="below" slideDistance={40}>
        {items.map((it) => (
          <div
            key={it.title}
            style={{
              height: 128,
              marginBottom: 18,
              borderRadius: 22,
              background: COLORS.paper,
              border: `3px solid ${COLORS.green}`,
              boxShadow: "0 14px 32px rgba(22,163,74,0.14)",
              display: "grid",
              gridTemplateColumns: "120px 1fr 90px",
              alignItems: "center",
              padding: "0 24px",
              fontFamily: FONTS.sans,
            }}
          >
            <div style={{ fontSize: 58 }}>{it.emoji}</div>
            <div style={{ fontSize: 44, fontWeight: 950, color: COLORS.ink }}>{it.title}</div>
            <div style={{ fontSize: 46, color: COLORS.green, fontWeight: 950 }}>✓</div>
          </div>
        ))}
      </StackReveal>
    </div>
  );
};

const MoneyFlow: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < 180) return null;
  const arrow = interpolate(frame, [220, 330], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  return (
    <div style={{ ...rectStyle(slots.stage), zIndex: 11, fontFamily: FONTS.sans }}>
      <PopIn startFrame={180} springConfig={SPRINGS.enter}>
        <div
          style={{
            position: "absolute",
            left: 40,
            top: 590,
            width: 280,
            height: 230,
            borderRadius: 24,
            background: "rgba(254,226,226,0.9)",
            border: `4px solid ${COLORS.red}`,
            display: "grid",
            placeItems: "center",
            textAlign: "center",
            fontSize: 36,
            fontWeight: 950,
            color: COLORS.red,
          }}
        >
          保健品<br />付款
        </div>
      </PopIn>
      <svg width={870} height={1040} style={{ position: "absolute", inset: 0 }}>
        <line x1={330} y1={700} x2={330 + 240 * arrow} y2={700} stroke={COLORS.green} strokeWidth={16} strokeLinecap="round" />
        <polygon points="570,670 630,700 570,730" fill={COLORS.green} />
      </svg>
      <PopIn startFrame={300} springConfig={SPRINGS.pop}>
        <div
          style={{
            position: "absolute",
            right: 40,
            top: 560,
            width: 330,
            height: 290,
            borderRadius: 28,
            background: COLORS.green,
            color: "white",
            display: "grid",
            placeItems: "center",
            textAlign: "center",
            fontSize: 44,
            fontWeight: 950,
            boxShadow: "0 22px 52px rgba(22,163,74,0.3)",
          }}
        >
          🐟🍤🍎<br />真实食物
        </div>
      </PopIn>
      {frame >= 380 && (
        <PopIn startFrame={380} springConfig={SPRINGS.pop}>
          <div
            style={{
              position: "absolute",
              left: 90,
              top: 900,
              width: 720,
              height: 120,
              borderRadius: 18,
              background: COLORS.blueDeep,
              color: "white",
              display: "grid",
              placeItems: "center",
              fontSize: 50,
              fontWeight: 950,
            }}
          >
            省下钱，买真实食物
          </div>
        </PopIn>
      )}
    </div>
  );
};

export const SVU19PlanDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const active = beats.find((b) => isBetween(frame, b.start, b.end))?.id;
  return (
    <AbsoluteFill style={{ background: COLORS.bg, overflow: "hidden" }}>
      <PageBackground />
      <ProgressStrip slot={slots.topProgress} beats={beats} activeBeatId={active} beatColor={COLORS.green} activeChapter="收尾" />
      <div style={{ ...rectStyle(slots.stage), zIndex: 4 }}>
        <ActionRecap />
        <MoneyFlow />
      </div>
      <Presenter slot={slots.presenterLeftBottom} frame={frame} size="small" />
      <RealSubtitle slot={slots.subtitleBand} cues={subtitles} frame={frame} />
      <PlatformChrome rightRail={slots.rightRail} platformTitle={slots.platformTitle} />
    </AbsoluteFill>
  );
};
