// SVU02 — presentation_family: talking_head_only
// V4 spec: id=SVU02, time=8.32-12.96s (4.64s, 139 frames), attention_owner=doctor
// one_screen_message: "吃错真的会出事"
// presentation_strategy: 主播口播段 + 轻警示字效

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
  type SubtitleCue,
  type SlotRect,
  rectStyle,
  isBetween,
} from "./plan-shared";

export const svu02Plan = {
  id: "SVU02",
  title: "吃错真的会出事",
  presentationFamily: "talking_head_only",
  durationFrames: 139,
  fps: 30,
  rules: [
    "presenter dominates the frame; no structural graphics or charts.",
    "only one decoration: a single warning sticker that pops in.",
    "subtitle is the main carrier of meaning — bold + highlighted keyword.",
  ],
  slots: {
    topProgress: { x: 28, y: 28, w: 1024, h: 114 },
    presenterCenter: { x: 200, y: 240, w: 680, h: 1100 },
    warningSticker: { x: 760, y: 280, w: 280, h: 280 },
    subtitleBand: { x: 44, y: 1490, w: 850, h: 130 },
    platformTitle: { x: 0, y: 1788, w: 1080, h: 132 },
    rightRail: { x: 940, y: 1100, w: 140, h: 600 },
  } satisfies Record<string, SlotRect>,
  beats: [
    { id: "warn", start: 0, end: 139, goal: "doctor delivers warning; sticker punches in" },
  ],
  subtitles: [
    { start: 0, end: 50, text: "其实有些\n保健品", highlight: "保健品" },
    { start: 50, end: 90, text: "不光白花钱", highlight: "白花钱" },
    { start: 90, end: 139, text: "吃错了\n还真的会出事儿", highlight: "出事儿" },
  ] satisfies SubtitleCue[],
} as const;

const PresenterLarge: React.FC = () => null;

const WarningSticker: React.FC = () => {
  const frame = useCurrentFrame();
  const slot = svu02Plan.slots.warningSticker;
  const wiggle = Math.sin(frame / 8) * 6;
  return (
    <PopIn startFrame={20} springConfig={SPRINGS.pop}>
      <div
        style={{
          ...rectStyle(slot),
          zIndex: 14,
          transform: `rotate(${-8 + wiggle * 0.4}deg)`,
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: "50%",
            background: COLORS.amber,
            color: "white",
            display: "grid",
            placeItems: "center",
            fontFamily: FONTS.sans,
            fontSize: 36,
            fontWeight: 950,
            textAlign: "center",
            border: "8px solid white",
            boxShadow: "0 16px 38px rgba(245,158,11,0.45)",
            letterSpacing: 1,
            lineHeight: 1.2,
          }}
        >
          ⚠️<br />
          会 出 事
        </div>
      </div>
    </PopIn>
  );
};

export const SVU02PlanDemo: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: COLORS.bg, overflow: "hidden" }}>
      <PageBackground />
      <ProgressStrip
        slot={svu02Plan.slots.topProgress}
        beats={[{ id: "warn", label: "主播警示" }]}
        activeBeatId="warn"
        beatColor={COLORS.amber}
        activeChapter="开场"
      />
      <PresenterLarge />
      <WarningSticker />
      <RealSubtitle slot={svu02Plan.slots.subtitleBand} cues={svu02Plan.subtitles} frame={frame} />
      <PlatformChrome
        rightRail={svu02Plan.slots.rightRail}
        platformTitle={svu02Plan.slots.platformTitle}
      />
    </AbsoluteFill>
  );
};
