// SVU15 - presentation_family: pivot_title
// one_screen_message: "三件小事就够了"

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
  rectStyle,
} from "./plan-shared";

const slots = {
  topProgress: { x: 28, y: 28, w: 1024, h: 114 },
  stage: { x: 70, y: 320, w: 820, h: 820 },
  presenterLeftBottom: { x: 30, y: 1370, w: 280, h: 340 },
  subtitleBand: { x: 44, y: 1490, w: 850, h: 130 },
  platformTitle: { x: 0, y: 1788, w: 1080, h: 132 },
  rightRail: { x: 940, y: 1100, w: 140, h: 600 },
} satisfies Record<string, SlotRect>;

const subtitles: SubtitleCue[] = [
  { start: 0, end: 50, text: "其实真正要做的", highlight: "真正" },
  { start: 50, end: 106, text: "就三件小事", highlight: "三件小事" },
];

const TitleBurst: React.FC = () => {
  const frame = useCurrentFrame();
  const rings = [0, 1, 2];
  return (
    <div style={{ ...rectStyle(slots.stage), zIndex: 10, fontFamily: FONTS.sans }}>
      {rings.map((i) => (
        <PopIn key={i} startFrame={12 + i * 10} springConfig={SPRINGS.pop}>
          <div
            style={{
              position: "absolute",
              left: 120 + i * 210,
              top: 100,
              width: 170,
              height: 170,
              borderRadius: "50%",
              background: [COLORS.amber, COLORS.green, COLORS.blueDeep][i],
              color: "white",
              display: "grid",
              placeItems: "center",
              fontSize: 80,
              fontFamily: FONTS.num,
              fontWeight: 950,
              boxShadow: `0 18px 42px ${[COLORS.amber, COLORS.green, COLORS.blueDeep][i]}55`,
            }}
          >
            {i + 1}
          </div>
        </PopIn>
      ))}
      <PopIn startFrame={42} springConfig={SPRINGS.pop}>
        <div
          style={{
            position: "absolute",
            left: 10,
            top: 360,
            width: 800,
            borderRadius: 24,
            background: COLORS.paper,
            border: `4px solid ${COLORS.green}`,
            boxShadow: "0 26px 60px rgba(22,163,74,0.24)",
            padding: "42px 30px",
            textAlign: "center",
            fontSize: 84,
            fontWeight: 950,
            color: COLORS.ink,
            lineHeight: 1.08,
          }}
        >
          三件小事<br />
          <span style={{ color: COLORS.green }}>就够了</span>
        </div>
      </PopIn>
      <div
        style={{
          position: "absolute",
          left: 160,
          top: 720,
          width: interpolate(frame, [60, 104], [0, 500], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          height: 10,
          borderRadius: 999,
          background: COLORS.green,
        }}
      />
    </div>
  );
};

export const SVU15PlanDemo: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: COLORS.bg, overflow: "hidden" }}>
      <PageBackground />
      <ProgressStrip
        slot={slots.topProgress}
        beats={[{ id: "pivot", label: "转行动" }]}
        activeBeatId="pivot"
        beatColor={COLORS.green}
        activeChapter="三件事"
      />
      <TitleBurst />
      <Presenter slot={slots.presenterLeftBottom} frame={frame} size="small" />
      <RealSubtitle slot={slots.subtitleBand} cues={subtitles} frame={frame} />
      <PlatformChrome rightRail={slots.rightRail} platformTitle={slots.platformTitle} />
    </AbsoluteFill>
  );
};
