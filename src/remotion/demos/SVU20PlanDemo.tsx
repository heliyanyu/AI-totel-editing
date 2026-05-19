// SVU20 - presentation_family: doctor_cta
// one_screen_message: "转给长辈，别再被忽悠"

import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

import { PopIn, SPRINGS } from "./motion-primitives";
import {
  COLORS,
  FONTS,
  PageBackground,
  PlatformChrome,
  ProgressStrip,
  RealSubtitle,
  type SlotRect,
  type SubtitleCue,
  isBetween,
  rectStyle,
} from "./plan-shared";

const slots = {
  topProgress: { x: 28, y: 28, w: 1024, h: 114 },
  presenter: { x: 180, y: 250, w: 560, h: 930 },
  shareCard: { x: 580, y: 760, w: 320, h: 360 },
  subtitleBand: { x: 44, y: 1490, w: 850, h: 130 },
  platformTitle: { x: 0, y: 1788, w: 1080, h: 132 },
  rightRail: { x: 940, y: 1100, w: 140, h: 600 },
} satisfies Record<string, SlotRect>;

const beats = [
  { id: "share", start: 0, end: 210, label: "转发" },
  { id: "follow", start: 210, end: 377, label: "关注" },
] as const;

const subtitles: SubtitleCue[] = [
  { start: 0, end: 110, text: "把这条转给\n家里长辈", highlight: "家里长辈" },
  { start: 110, end: 210, text: "别再被这些\n保健品忽悠", highlight: "忽悠" },
  { start: 210, end: 377, text: "不交智商税\n我继续给你讲", highlight: "继续" },
];

const PresenterHero: React.FC = () => null;

const ShareCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = spring({
    frame: Math.max(0, frame - 70),
    fps,
    config: SPRINGS.enter,
    durationInFrames: 30,
  });
  const y = interpolate(t, [0, 1], [70, 0]);
  return (
    <div style={{ ...rectStyle(slots.shareCard), zIndex: 14, transform: `translateY(${y}px)` }}>
      <PopIn startFrame={70} springConfig={SPRINGS.pop}>
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 28,
            background: COLORS.paper,
            border: `4px solid ${COLORS.blueDeep}`,
            boxShadow: "0 22px 52px rgba(37,99,235,0.24)",
            display: "grid",
            placeItems: "center",
            textAlign: "center",
            fontFamily: FONTS.sans,
            padding: 22,
          }}
        >
          <div style={{ fontSize: 92 }}>↗</div>
          <div style={{ fontSize: 42, fontWeight: 950, color: COLORS.blueDeep }}>转给长辈</div>
          <div style={{ fontSize: 24, fontWeight: 850, color: COLORS.inkSoft }}>别再被忽悠</div>
        </div>
      </PopIn>
    </div>
  );
};

const FollowPill: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < 220) return null;
  const pulse = 1 + Math.sin((frame - 220) / 8) * 0.035;
  return (
    <PopIn startFrame={220} springConfig={SPRINGS.pop}>
      <div
        style={{
          position: "absolute",
          left: 110,
          top: 1160,
          width: 760,
          height: 130,
          borderRadius: 999,
          background: COLORS.red,
          color: "white",
          display: "grid",
          placeItems: "center",
          fontFamily: FONTS.sans,
          fontSize: 50,
          fontWeight: 950,
          boxShadow: "0 18px 42px rgba(220,38,38,0.3)",
          transform: `scale(${pulse})`,
          zIndex: 15,
        }}
      >
        不交智商税，继续讲
      </div>
    </PopIn>
  );
};

export const SVU20PlanDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const active = beats.find((b) => isBetween(frame, b.start, b.end))?.id;
  return (
    <AbsoluteFill style={{ background: COLORS.bg, overflow: "hidden" }}>
      <PageBackground />
      <ProgressStrip slot={slots.topProgress} beats={beats} activeBeatId={active} beatColor={COLORS.red} activeChapter="收尾" />
      <PresenterHero />
      <ShareCard />
      <FollowPill />
      <RealSubtitle slot={slots.subtitleBand} cues={subtitles} frame={frame} />
      <PlatformChrome rightRail={slots.rightRail} platformTitle={slots.platformTitle} />
    </AbsoluteFill>
  );
};
