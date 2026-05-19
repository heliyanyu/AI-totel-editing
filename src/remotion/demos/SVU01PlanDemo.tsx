// SVU01 — presentation_family: comparison_split
// V4 spec: id=SVU01, time=0.8-7.92s (7.12s, 213 frames), attention_owner=visual
// one_screen_message: "药嫌贵，保健品不手软"
// presentation_strategy: 对比屏

import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

import { PopIn, SPRINGS } from "./motion-primitives";
import {
  COLORS,
  FONTS,
  PageBackground,
  PlatformChrome,
  Presenter,
  ProgressStrip,
  RealSubtitle,
  type SubtitleCue,
  type SlotRect,
  rectStyle,
  isBetween,
} from "./plan-shared";

export const svu01Plan = {
  id: "SVU01",
  title: "药嫌贵，保健品不手软",
  presentationFamily: "comparison_split",
  durationFrames: 213,
  fps: 30,
  rules: [
    "left and right sides enter symmetrically; mirrored slide-in.",
    "VS badge in the middle is the connector — appears after both sides settle.",
    "no element ever crosses the midline.",
  ],
  slots: {
    topProgress: { x: 28, y: 28, w: 1024, h: 114 },
    leftSide: { x: 40, y: 280, w: 460, h: 760 },
    rightSide: { x: 580, y: 280, w: 460, h: 760 },
    vsBadge: { x: 480, y: 600, w: 120, h: 120 },
    presenterLeftBottom: { x: 30, y: 1370, w: 280, h: 340 },
    subtitleBand: { x: 44, y: 1490, w: 850, h: 130 },
    platformTitle: { x: 0, y: 1788, w: 1080, h: 132 },
    rightRail: { x: 940, y: 1100, w: 140, h: 600 },
  } satisfies Record<string, SlotRect>,
  beats: [
    { id: "beat1_left", start: 0, end: 80, goal: "left side enters: cheap medicine yet refused" },
    { id: "beat2_right", start: 80, end: 160, goal: "right side enters: expensive supplements bought freely" },
    { id: "beat3_punchline", start: 160, end: 213, goal: "VS badge + tagline pulls them together" },
  ],
  subtitles: [
    { start: 0, end: 60, text: "我发现\n好多朋友", highlight: "好多朋友" },
    { start: 60, end: 110, text: "几十块钱的药\n嫌贵", highlight: "嫌贵" },
    { start: 110, end: 170, text: "但几千上万的保健品\n买起来", highlight: "几千上万" },
    { start: 170, end: 213, text: "手都不带软的", highlight: "不带软" },
  ] satisfies SubtitleCue[],
} as const;

const Side: React.FC<{
  slot: SlotRect;
  enterFrame: number;
  fromLeft: boolean;
  emoji: string;
  title: string;
  subtitle: string;
  color: string;
  bgTint: string;
  topLabel: string;
}> = ({ slot, enterFrame, fromLeft, emoji, title, subtitle, color, bgTint, topLabel }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = spring({
    frame: Math.max(0, frame - enterFrame),
    fps,
    config: SPRINGS.glide,
    durationInFrames: 30,
  });
  const opacity = interpolate(frame - enterFrame, [0, 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const dx = (fromLeft ? -90 : 90) * (1 - t);
  if (frame < enterFrame - 2) return null;

  return (
    <div
      style={{
        ...rectStyle(slot),
        zIndex: 8,
        opacity,
        transform: `translateX(${dx}px)`,
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          background: bgTint,
          border: `4px solid ${color}`,
          borderRadius: 28,
          padding: "30px 24px",
          boxShadow: `0 24px 56px ${color}33`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          fontFamily: FONTS.sans,
        }}
      >
        <div
          style={{
            background: color,
            color: "white",
            padding: "8px 24px",
            borderRadius: 999,
            fontSize: 26,
            fontWeight: 950,
            letterSpacing: 2,
          }}
        >
          {topLabel}
        </div>
        <div style={{ fontSize: 220, lineHeight: 1, marginTop: 4 }}>{emoji}</div>
        <div
          style={{
            fontSize: 56,
            fontWeight: 950,
            color: COLORS.ink,
            textAlign: "center",
            lineHeight: 1.15,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 38,
            fontWeight: 950,
            color,
            textAlign: "center",
          }}
        >
          {subtitle}
        </div>
      </div>
    </div>
  );
};

const VSBadge: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < 70) return null;
  return (
    <PopIn startFrame={70} springConfig={SPRINGS.pop}>
      <div
        style={{
          ...rectStyle(svu01Plan.slots.vsBadge),
          zIndex: 14,
          borderRadius: "50%",
          background: COLORS.ink,
          color: "white",
          fontFamily: FONTS.num,
          fontSize: 56,
          fontWeight: 950,
          display: "grid",
          placeItems: "center",
          letterSpacing: -2,
          boxShadow: "0 18px 38px rgba(15,23,42,0.42)",
          border: `5px solid white`,
        }}
      >
        VS
      </div>
    </PopIn>
  );
};

const PunchLine: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < 160) return null;
  return (
    <PopIn startFrame={160} springConfig={SPRINGS.pop}>
      <div
        style={{
          position: "absolute",
          left: 60,
          width: 820,
          top: 1080,
          textAlign: "center",
          zIndex: 12,
          fontFamily: FONTS.sans,
          fontSize: 48,
          fontWeight: 950,
          color: COLORS.ink,
          padding: "16px 28px",
          background: "rgba(255,255,255,0.85)",
          borderRadius: 14,
          border: `2px solid ${COLORS.amber}`,
          boxShadow: "0 14px 30px rgba(245,158,11,0.22)",
        }}
      >
        反差就在 <span style={{ color: COLORS.red }}>这一念之间</span>
      </div>
    </PopIn>
  );
};

export const SVU01PlanDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const beats = svu01Plan.beats;
  const active = beats.find((b) => isBetween(frame, b.start, b.end))?.id;
  return (
    <AbsoluteFill style={{ background: COLORS.bg, overflow: "hidden" }}>
      <PageBackground />
      <ProgressStrip
        slot={svu01Plan.slots.topProgress}
        beats={[
          { id: "beat1_left", label: "现实" },
          { id: "beat2_right", label: "反差" },
          { id: "beat3_punchline", label: "金句" },
        ]}
        activeBeatId={active}
        beatColor={COLORS.red}
        activeChapter="开场"
      />
      <Side
        slot={svu01Plan.slots.leftSide}
        enterFrame={4}
        fromLeft={true}
        emoji="💊"
        title={"几十块的药"}
        subtitle={"嫌贵 🤨"}
        color={COLORS.red}
        bgTint="rgba(254, 226, 226, 0.6)"
        topLabel="现 实 行 为"
      />
      <Side
        slot={svu01Plan.slots.rightSide}
        enterFrame={42}
        fromLeft={false}
        emoji="💸"
        title={"上万保健品"}
        subtitle={"不眨眼 😎"}
        color={COLORS.green}
        bgTint="rgba(209, 250, 229, 0.6)"
        topLabel="花 钱 方 向"
      />
      <VSBadge />
      <PunchLine />
      <Presenter slot={svu01Plan.slots.presenterLeftBottom} frame={frame} size="small" />
      <RealSubtitle slot={svu01Plan.slots.subtitleBand} cues={svu01Plan.subtitles} frame={frame} />
      <PlatformChrome
        rightRail={svu01Plan.slots.rightRail}
        platformTitle={svu01Plan.slots.platformTitle}
      />
    </AbsoluteFill>
  );
};
