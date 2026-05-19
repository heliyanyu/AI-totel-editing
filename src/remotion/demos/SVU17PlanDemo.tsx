// SVU17 — presentation_family: data_pop
// V4 spec: id=SVU17, time=197.68-209.36s (11.68s, 350 frames), attention_owner=text
// one_screen_message: "每周至少 150 分钟"
// presentation_strategy: 数字披露 + 判定标准屏

import React from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame } from "remotion";
import { CountUp, PopIn, SPRINGS } from "./motion-primitives";
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

export const svu17Plan = {
  id: "SVU17",
  title: "每周至少 150 分钟",
  presentationFamily: "data_pop",
  durationFrames: 350,
  fps: 30,
  rules: [
    "the number is the only true subject; everything else supports it.",
    "context (top + bottom) appears before the number, never after.",
    "criterion (intensity rule) enters last, sealing the actionable rule.",
  ],
  slots: {
    topProgress: { x: 28, y: 28, w: 1024, h: 114 },
    numberStage: { x: 60, y: 240, w: 960, h: 720 },
    sportsRow: { x: 60, y: 980, w: 820, h: 220 },
    criterion: { x: 60, y: 1200, w: 820, h: 160 },
    presenterLeftBottom: { x: 30, y: 1370, w: 280, h: 340 },
    subtitleBand: { x: 44, y: 1490, w: 850, h: 130 },
    platformTitle: { x: 0, y: 1788, w: 1080, h: 132 },
    rightRail: { x: 940, y: 1100, w: 140, h: 600 },
  } satisfies Record<string, SlotRect>,
  beats: [
    { id: "context", start: 0, end: 80, goal: "set the topic: weekly exercise" },
    { id: "number", start: 80, end: 200, goal: "150 minutes pop in with count-up" },
    { id: "criterion", start: 200, end: 350, goal: "intensity criterion + sport options" },
  ],
  subtitles: [
    { start: 0, end: 60, text: "第二样呢\n就是坚持运动", highlight: "运动" },
    { start: 60, end: 160, text: "每周至少运动\n一百五十分钟", highlight: "一百五十分钟" },
    { start: 160, end: 220, text: "中等强度", highlight: "中等强度" },
    { start: 220, end: 280, text: "快走、慢跑、\n游泳都行", highlight: "都行" },
    { start: 280, end: 350, text: "有点喘 能说话\n但唱不了歌", highlight: "喘" },
  ] satisfies SubtitleCue[],
} as const;

const NumberStage: React.FC = () => {
  const frame = useCurrentFrame();
  const slot = svu17Plan.slots.numberStage;
  return (
    <div
      style={{
        ...rectStyle(slot),
        zIndex: 10,
        display: "grid",
        placeItems: "center",
        textAlign: "center",
        fontFamily: FONTS.sans,
      }}
    >
      <PopIn startFrame={4} springConfig={SPRINGS.enter}>
        <div style={{ fontSize: 36, fontWeight: 950, color: COLORS.inkSoft, letterSpacing: 4 }}>
          每 周 中 等 强 度 运 动
        </div>
      </PopIn>
      <PopIn startFrame={84} springConfig={SPRINGS.pop} durationFrames={28}>
        <div
          style={{
            fontFamily: FONTS.num,
            fontSize: 360,
            fontWeight: 950,
            lineHeight: 0.92,
            background: `linear-gradient(180deg, ${COLORS.green}, #047857)`,
            WebkitBackgroundClip: "text",
            color: "transparent",
            textShadow: "0 28px 60px rgba(22,163,74,0.18)",
            marginTop: 4,
          }}
        >
          <CountUp startFrame={86} durationFrames={48} from={0} to={150} />
        </div>
      </PopIn>
      <PopIn startFrame={130} springConfig={SPRINGS.pop}>
        <div
          style={{
            fontSize: 60,
            fontWeight: 950,
            color: COLORS.green,
            letterSpacing: 3,
            marginTop: -8,
          }}
        >
          分 钟 / 周
        </div>
      </PopIn>
      <PopIn startFrame={170} springConfig={SPRINGS.enter}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            background: COLORS.greenSoft,
            color: "#065F46",
            borderRadius: 999,
            padding: "10px 22px",
            fontSize: 26,
            fontWeight: 950,
            letterSpacing: 2,
            marginTop: 14,
          }}
        >
          ✓ WHO 推荐底线
        </div>
      </PopIn>
    </div>
  );
};

const SportsRow: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < 200) return null;
  const slot = svu17Plan.slots.sportsRow;
  const items = [
    { emoji: "🚶‍♂️", label: "快走" },
    { emoji: "🏃", label: "慢跑" },
    { emoji: "🏊", label: "游泳" },
  ];
  return (
    <div
      style={{
        ...rectStyle(slot),
        zIndex: 10,
        display: "flex",
        gap: 18,
        justifyContent: "center",
        fontFamily: FONTS.sans,
      }}
    >
      {items.map((it, i) => {
        const enterFrame = 210 + i * 18;
        return (
          <PopIn
            key={it.label}
            startFrame={enterFrame}
            springConfig={SPRINGS.pop}
            durationFrames={22}
          >
            <div
              style={{
                width: 246,
                height: 200,
                borderRadius: 24,
                background: COLORS.paper,
                border: `3px solid ${COLORS.green}`,
                boxShadow: "0 14px 32px rgba(22,163,74,0.18)",
                display: "grid",
                placeItems: "center",
                gap: 8,
                padding: 8,
              }}
            >
              <div style={{ fontSize: 86, lineHeight: 1 }}>{it.emoji}</div>
              <div style={{ fontSize: 36, fontWeight: 950, color: COLORS.ink }}>{it.label}</div>
            </div>
          </PopIn>
        );
      })}
    </div>
  );
};

const Criterion: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < 268) return null;
  const slot = svu17Plan.slots.criterion;
  return (
    <PopIn startFrame={268} springConfig={SPRINGS.pop}>
      <div
        style={{
          ...rectStyle(slot),
          zIndex: 11,
          background: COLORS.amber,
          color: "white",
          borderRadius: 18,
          padding: "16px 26px",
          fontFamily: FONTS.sans,
          fontSize: 34,
          fontWeight: 950,
          textAlign: "center",
          boxShadow: "0 18px 40px rgba(245,158,11,0.32)",
          letterSpacing: 2,
          display: "grid",
          placeItems: "center",
        }}
      >
        判定标准：有点喘 · 能说话 · 唱不了歌
      </div>
    </PopIn>
  );
};

export const SVU17PlanDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const beats = svu17Plan.beats;
  const active = beats.find((b) => isBetween(frame, b.start, b.end))?.id;
  return (
    <AbsoluteFill style={{ background: COLORS.bg, overflow: "hidden" }}>
      <PageBackground />
      <ProgressStrip
        slot={svu17Plan.slots.topProgress}
        beats={[
          { id: "context", label: "话题" },
          { id: "number", label: "数字" },
          { id: "criterion", label: "标准" },
        ]}
        activeBeatId={active}
        beatColor={COLORS.green}
        activeChapter="三件事"
      />
      <NumberStage />
      <SportsRow />
      <Criterion />
      <Presenter slot={svu17Plan.slots.presenterLeftBottom} frame={frame} size="small" />
      <RealSubtitle slot={svu17Plan.slots.subtitleBand} cues={svu17Plan.subtitles} frame={frame} />
      <PlatformChrome
        rightRail={svu17Plan.slots.rightRail}
        platformTitle={svu17Plan.slots.platformTitle}
      />
    </AbsoluteFill>
  );
};
