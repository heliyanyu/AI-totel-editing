// SVU09 - presentation_family: closed_loop_board
// one_screen_message: "牛初乳：有抗体≠对人有用"

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
  board: { x: 48, y: 230, w: 870, h: 1050 },
  presenterLeftBottom: { x: 30, y: 1370, w: 280, h: 340 },
  subtitleBand: { x: 44, y: 1490, w: 850, h: 130 },
  platformTitle: { x: 0, y: 1788, w: 1080, h: 132 },
  rightRail: { x: 940, y: 1100, w: 140, h: 600 },
} satisfies Record<string, SlotRect>;

const beats = [
  { id: "claim", start: 0, end: 230, label: "卖点" },
  { id: "mismatch", start: 230, end: 520, label: "错配" },
  { id: "replace", start: 520, end: 746, label: "替代" },
] as const;

const subtitles: SubtitleCue[] = [
  { start: 0, end: 120, text: "牛初乳最爱说\n含抗体、免疫球蛋白", highlight: "含抗体" },
  { start: 120, end: 260, text: "听着是很厉害", highlight: "厉害" },
  { start: 260, end: 430, text: "但它本来\n是给小牛准备的", highlight: "小牛" },
  { start: 430, end: 580, text: "人吃进去\n性价比很一般", highlight: "性价比" },
  { start: 580, end: 746, text: "真不如\n喝杯纯牛奶", highlight: "纯牛奶" },
];

const ProductClaim: React.FC = () => {
  const frame = useCurrentFrame();
  const fold = interpolate(frame, [230, 300], [1, 0.74], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  return (
    <div
      style={{
        position: "absolute",
        left: 70,
        top: 310,
        width: 330,
        height: 380,
        transform: `scale(${fold})`,
        transformOrigin: "left top",
        zIndex: 8,
      }}
    >
      <PopIn startFrame={8} springConfig={SPRINGS.enter}>
        <div
          style={{
            height: "100%",
            borderRadius: 26,
            background: COLORS.paper,
            border: `4px solid ${COLORS.amber}`,
            boxShadow: "0 18px 42px rgba(245,158,11,0.22)",
            display: "grid",
            placeItems: "center",
            fontFamily: FONTS.sans,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 104 }}>🍼</div>
          <div style={{ fontSize: 38, fontWeight: 950, color: COLORS.ink }}>牛初乳</div>
          <div style={{ marginTop: 10, color: COLORS.amber, fontSize: 28, fontWeight: 950 }}>
            抗体 / 免疫球蛋白
          </div>
        </div>
      </PopIn>
    </div>
  );
};

const SpeciesMismatch: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < 230) return null;
  const arrow = interpolate(frame, [260, 340], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div style={{ position: "absolute", left: 420, top: 300, width: 430, height: 430, zIndex: 9 }}>
      <PopIn startFrame={230} springConfig={SPRINGS.enter}>
        <div
          style={{
            borderRadius: 26,
            background: "rgba(255,255,255,0.86)",
            border: `4px solid ${COLORS.blueDeep}`,
            boxShadow: "0 18px 42px rgba(37,99,235,0.18)",
            padding: 28,
            fontFamily: FONTS.sans,
          }}
        >
          <div style={{ fontSize: 34, color: COLORS.inkSoft, fontWeight: 900 }}>关键错配</div>
          <div style={{ display: "flex", alignItems: "center", gap: 22, marginTop: 24 }}>
            <div style={{ fontSize: 94 }}>🍼</div>
            <svg width={150} height={90}>
              <line
                x1={8}
                y1={45}
                x2={8 + 132 * arrow}
                y2={45}
                stroke={COLORS.blueDeep}
                strokeWidth={10}
                strokeLinecap="round"
              />
              <polygon points="132,24 150,45 132,66" fill={COLORS.blueDeep} />
            </svg>
            <div style={{ fontSize: 96 }}>🐄</div>
          </div>
          <div style={{ marginTop: 20, fontSize: 46, fontWeight: 950, color: COLORS.blueDeep }}>
            给小牛用
          </div>
        </div>
      </PopIn>
    </div>
  );
};

const Replacement: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < 520) return null;
  return (
    <PopIn startFrame={520} springConfig={SPRINGS.pop}>
      <div
        style={{
          position: "absolute",
          left: 90,
          top: 830,
          width: 760,
          height: 230,
          borderRadius: 26,
          background: COLORS.green,
          color: "white",
          display: "grid",
          gridTemplateColumns: "190px 1fr",
          alignItems: "center",
          padding: "0 30px",
          fontFamily: FONTS.sans,
          boxShadow: "0 22px 52px rgba(22,163,74,0.28)",
          zIndex: 12,
        }}
      >
        <div style={{ fontSize: 116, textAlign: "center" }}>🥛</div>
        <div>
          <div style={{ fontSize: 32, fontWeight: 850, opacity: 0.9 }}>更朴素的替代</div>
          <div style={{ fontSize: 58, fontWeight: 950, lineHeight: 1.1 }}>真不如喝杯纯牛奶</div>
        </div>
      </div>
    </PopIn>
  );
};

export const SVU09PlanDemo: React.FC = () => {
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
        activeChapter="牛初乳"
      />
      <div style={{ ...rectStyle(slots.board), zIndex: 4 }}>
        <ProductClaim />
        <SpeciesMismatch />
        <Replacement />
      </div>
      <Presenter slot={slots.presenterLeftBottom} frame={frame} size="small" />
      <RealSubtitle slot={slots.subtitleBand} cues={subtitles} frame={frame} />
      <PlatformChrome rightRail={slots.rightRail} platformTitle={slots.platformTitle} />
    </AbsoluteFill>
  );
};
