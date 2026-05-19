// SVU03 — presentation_family: kinetic_title
// V4 spec:
//   id: SVU03, time: 13.44-19.6s (6.16s, 185 frames)
//   attention_owner: text
//   one_screen_message: "掀开三大保健品底牌"
//   internal_beats: 1 (标题揭示)
//   presentation_strategy: 标题揭示屏

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

export const svu03Plan = {
  id: "SVU03",
  title: "掀开三大保健品底牌",
  presentationFamily: "kinetic_title",
  durationFrames: 185,
  fps: 30,
  rules: [
    "title is the main subject; nothing else competes with it.",
    "decoration props (cards, ribbons) enter and exit; never persist.",
    "presenter shrinks to give the title full visual weight.",
  ],
  slots: {
    topProgress: { x: 28, y: 28, w: 1024, h: 114 },
    titleStage: { x: 60, y: 360, w: 960, h: 760 },
    presenterLeftBottom: { x: 30, y: 1370, w: 280, h: 340 },
    subtitleBand: { x: 44, y: 1490, w: 850, h: 130 },
    platformTitle: { x: 0, y: 1788, w: 1080, h: 132 },
    rightRail: { x: 940, y: 1100, w: 140, h: 600 },
  } satisfies Record<string, SlotRect>,
  beats: [
    { id: "beat1_setup", start: 0, end: 60, goal: "props fly in (cards)" },
    { id: "beat2_title", start: 60, end: 130, goal: "title bursts in with overshoot" },
    { id: "beat3_seal", start: 130, end: 185, goal: "subtitle/seal locks the promise" },
  ],
  subtitles: [
    { start: 0, end: 60, text: "今天我", highlight: "今天" },
    { start: 60, end: 124, text: "把最常见的\n三个免疫力保健品", highlight: "三个" },
    { start: 124, end: 185, text: "底牌\n给你掀了", highlight: "底牌" },
  ] satisfies SubtitleCue[],
} as const;

const PokerCards: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // 3 poker cards fly in from offstage with stagger
  const cards = [
    { rotate: -12, dx: -460, color: COLORS.red, label: "鱼油", emoji: "🐟" },
    { rotate: 4, dx: 0, color: COLORS.blueDeep, label: "牛初乳", emoji: "🐄" },
    { rotate: 14, dx: 460, color: COLORS.purple, label: "灵芝粉", emoji: "🍄" },
  ];
  return (
    <div
      style={{
        position: "absolute",
        left: 540,
        top: 480,
        zIndex: 5,
        width: 0,
        height: 0,
      }}
    >
      {cards.map((c, i) => {
        const enterFrame = 4 + i * 14;
        const t = spring({
          frame: Math.max(0, frame - enterFrame),
          fps,
          config: SPRINGS.enter,
          durationInFrames: 26,
        });
        const opacity = interpolate(frame - enterFrame, [0, 8], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        // After title bursts (frame 60+), cards drift outward and fade slightly
        const driftT = interpolate(frame, [60, 100], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const drift = driftT * (c.dx > 0 ? 60 : c.dx < 0 ? -60 : 0);
        const fadeOut = interpolate(frame, [120, 180], [1, 0.55], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: c.dx + drift,
              top: 0,
              transform: `translate(-50%, -50%) rotate(${c.rotate * t}deg) scale(${
                interpolate(t, [0, 1], [0.4, 1])
              })`,
              opacity: opacity * fadeOut,
              willChange: "transform, opacity",
            }}
          >
            <div
              style={{
                width: 220,
                height: 308,
                borderRadius: 18,
                background: COLORS.paper,
                border: `4px solid ${c.color}`,
                boxShadow: "0 24px 50px rgba(15,23,42,0.22)",
                display: "grid",
                placeItems: "center",
                gap: 10,
                padding: "20px 0",
                fontFamily: FONTS.sans,
              }}
            >
              <div style={{ fontSize: 96, lineHeight: 1 }}>{c.emoji}</div>
              <div
                style={{
                  background: c.color,
                  color: "white",
                  padding: "8px 18px",
                  borderRadius: 8,
                  fontSize: 28,
                  fontWeight: 950,
                }}
              >
                {c.label}
              </div>
              <div
                style={{
                  fontSize: 60,
                  color: c.color,
                  fontFamily: FONTS.num,
                  fontWeight: 950,
                }}
              >
                {i + 1}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

const HeroTitle: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Title bursts in at frame 60 with overshoot
  const t = spring({
    frame: Math.max(0, frame - 60),
    fps,
    config: SPRINGS.pop,
    durationInFrames: 28,
  });
  const opacity = interpolate(frame - 60, [0, 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  if (frame < 60) return null;
  // Pulsing glow once revealed
  const pulse = 1 + 0.018 * Math.sin((frame - 60) / 10);
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 880,
        textAlign: "center",
        zIndex: 12,
        transform: `scale(${interpolate(t, [0, 1], [0.6, 1]) * pulse})`,
        opacity,
        fontFamily: FONTS.sans,
      }}
    >
      <div
        style={{
          display: "inline-block",
          fontSize: 96,
          fontWeight: 950,
          color: COLORS.ink,
          letterSpacing: 4,
          textShadow: `4px 4px 0 ${COLORS.amber}, 8px 8px 0 ${COLORS.red}`,
          padding: "12px 40px",
        }}
      >
        掀开 三大 保健品 底牌
      </div>
      {/* underline grow */}
      <div
        style={{
          margin: "10px auto 0",
          height: 10,
          width: `${interpolate(frame, [80, 130], [0, 720], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })}px`,
          background: COLORS.red,
          borderRadius: 999,
          boxShadow: `0 0 20px ${COLORS.red}66`,
        }}
      />
    </div>
  );
};

const SealStamp: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < 130) return null;
  return (
    <PopIn startFrame={130} springConfig={SPRINGS.pop}>
      <div
        style={{
          position: "absolute",
          right: 180,
          top: 1100,
          zIndex: 14,
          width: 220,
          height: 220,
          borderRadius: "50%",
          border: `8px solid ${COLORS.red}`,
          background: "rgba(255,228,228,0.9)",
          color: COLORS.red,
          fontFamily: FONTS.sans,
          display: "grid",
          placeItems: "center",
          textAlign: "center",
          fontSize: 32,
          fontWeight: 950,
          letterSpacing: 2,
          transform: "rotate(-12deg)",
          boxShadow: "0 12px 32px rgba(220,38,38,0.32)",
        }}
      >
        医生<br />承诺
      </div>
    </PopIn>
  );
};

export const SVU03PlanDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const beats = svu03Plan.beats;
  const active = beats.find((b) => isBetween(frame, b.start, b.end))?.id;
  return (
    <AbsoluteFill style={{ background: COLORS.bg, overflow: "hidden" }}>
      <PageBackground />
      <ProgressStrip
        slot={svu03Plan.slots.topProgress}
        beats={[
          { id: "beat1_setup", label: "铺垫" },
          { id: "beat2_title", label: "爆出" },
          { id: "beat3_seal", label: "印章" },
        ]}
        activeBeatId={active}
        beatColor={COLORS.amber}
        activeChapter="开场"
      />
      <PokerCards />
      <HeroTitle />
      <SealStamp />
      <Presenter slot={svu03Plan.slots.presenterLeftBottom} frame={frame} size="small" />
      <RealSubtitle slot={svu03Plan.slots.subtitleBand} cues={svu03Plan.subtitles} frame={frame} />
      <PlatformChrome
        rightRail={svu03Plan.slots.rightRail}
        platformTitle={svu03Plan.slots.platformTitle}
      />
    </AbsoluteFill>
  );
};
