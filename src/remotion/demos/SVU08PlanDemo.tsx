// SVU08 — presentation_family: decision_tree
// V4 spec:
//   id: SVU08
//   time: 70.64-82.08s (11.44s, 343 frames @ 30fps)
//   attention_owner: board
//   one_screen_message: "你平时吃鱼吗？"
//   internal_beats: 1 ("决策树")
//   presentation_strategy: 决策树屏

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
  type SlotRect,
  type SubtitleCue,
  rectStyle,
  isBetween,
} from "./plan-shared";

// ─── Plan ────────────────────────────────────────────────────────
export const svu08Plan = {
  id: "SVU08",
  title: "你平时吃鱼吗？",
  presentationFamily: "decision_tree",
  durationFrames: 343,
  fps: 30,
  rules: [
    "left and right branches enter symmetrically; never one without the other.",
    "the 'recommended' branch is highlighted in green; the alternative in amber/neutral.",
    "trunk lines are drawn before nodes appear (path before content).",
    "presenter stays small at left-bottom; doesn't compete with the tree.",
  ],
  slots: {
    topProgress: { x: 28, y: 28, w: 1024, h: 114, description: "full-width" },
    treeRoot: { x: 220, y: 240, w: 640, h: 200, description: "root question" },
    leftBranch: { x: 60, y: 580, w: 460, h: 480, description: "yes-branch (规律吃鱼)" },
    rightBranch: { x: 560, y: 580, w: 460, h: 480, description: "no-branch (几乎不吃)" },
    presenterLeftBottom: {
      x: 30,
      y: 1370,
      w: 280,
      h: 340,
      description: "small avatar — diagram-class lets the tree dominate",
    },
    sourceNote: {
      x: 350,
      y: 1370,
      w: 540,
      h: 130,
      description: "tiny note: 适用人群提示",
    },
    subtitleBand: { x: 44, y: 1490, w: 850, h: 130, description: "real subtitles" },
    platformTitle: { x: 0, y: 1788, w: 1080, h: 132, description: "platform title overlay" },
    rightRail: { x: 940, y: 1100, w: 140, h: 600, description: "bottom-right only" },
  } satisfies Record<string, SlotRect>,
  beats: [
    {
      id: "beat1_question",
      start: 0,
      end: 90,
      goal: "ask the deciding question",
    },
    {
      id: "beat2_branches",
      start: 90,
      end: 200,
      goal: "draw two paths from the root with their conditions",
    },
    {
      id: "beat3_results",
      start: 200,
      end: 343,
      goal: "reveal each path's outcome and highlight the recommended one",
    },
  ],
  subtitles: [
    {
      start: 0,
      end: 76,
      text: "常年一口鱼\n都不沾的人",
      highlight: "一口鱼都不沾",
    },
    {
      start: 76,
      end: 158,
      text: "偶尔补一补\n那还行",
      highlight: "偶尔补一补",
    },
    {
      start: 158,
      end: 252,
      text: "平时规律吃鱼\n鱼油就",
      highlight: "规律吃鱼",
    },
    {
      start: 252,
      end: 343,
      text: "完全没必要\n买了",
      highlight: "完全没必要",
    },
  ] satisfies SubtitleCue[],
} as const;

// ─── Components ──────────────────────────────────────────────────

const TreeRoot: React.FC = () => {
  const frame = useCurrentFrame();
  const s = svu08Plan.slots.treeRoot;
  return (
    <PopIn startFrame={4} springConfig={SPRINGS.enter}>
      <div
        style={{
          ...rectStyle(s),
          zIndex: 12,
          display: "grid",
          placeItems: "center",
        }}
      >
        <div
          style={{
            background: COLORS.blueDeep,
            color: "white",
            padding: "30px 50px",
            borderRadius: 22,
            fontFamily: FONTS.sans,
            fontSize: 60,
            fontWeight: 950,
            letterSpacing: 2,
            boxShadow: "0 18px 42px rgba(37,99,235,0.32)",
          }}
        >
          你平时吃鱼吗？🤔
        </div>
      </div>
    </PopIn>
  );
};

const TreeLines: React.FC = () => {
  const frame = useCurrentFrame();
  const draw = interpolate(frame, [88, 132], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  if (frame < 88) return null;
  // root center is approx (540, 360 + a bit), branches are at (290, 580) and (790, 580)
  const rootX = 540;
  const rootY = 460;
  const lyx = 290;
  const lyy = 580;
  const ryx = 790;
  const ryy = 580;
  // Interpolate the visible portion of each line via stroke-dasharray
  return (
    <svg
      width={1080}
      height={1920}
      style={{ position: "absolute", inset: 0, zIndex: 9, pointerEvents: "none" }}
    >
      <defs>
        <filter id="tree-line-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* Left branch */}
      <line
        x1={rootX}
        y1={rootY}
        x2={rootX + (lyx - rootX) * draw}
        y2={rootY + (lyy - rootY) * draw}
        stroke={COLORS.green}
        strokeWidth={6}
        strokeLinecap="round"
        filter="url(#tree-line-glow)"
      />
      {/* Right branch */}
      <line
        x1={rootX}
        y1={rootY}
        x2={rootX + (ryx - rootX) * draw}
        y2={rootY + (ryy - rootY) * draw}
        stroke={COLORS.amber}
        strokeWidth={6}
        strokeLinecap="round"
        filter="url(#tree-line-glow)"
      />
    </svg>
  );
};

const BranchCard: React.FC<{
  slot: SlotRect;
  enterFrame: number;
  conditionLabel: string;
  conditionEmoji: string;
  resultText: string;
  resultEmoji: string;
  color: string;
  recommended: boolean;
}> = ({
  slot,
  enterFrame,
  conditionLabel,
  conditionEmoji,
  resultText,
  resultEmoji,
  color,
  recommended,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = spring({
    frame: Math.max(0, frame - enterFrame),
    fps,
    config: SPRINGS.enter,
    durationInFrames: 26,
  });
  const opacity = interpolate(frame - enterFrame, [0, 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const dy = interpolate(t, [0, 1], [40, 0]);
  if (frame < enterFrame) return null;

  const recommendedFrame = svu08Plan.beats[2].start + 30;
  const highlight = recommended && frame >= recommendedFrame;
  const pulse = highlight ? 1 + 0.04 * Math.sin((frame - recommendedFrame) / 6) : 1;

  return (
    <div
      style={{
        ...rectStyle(slot),
        opacity,
        transform: `translateY(${dy}px) scale(${pulse})`,
        transformOrigin: "center top",
        zIndex: 11,
      }}
    >
      {/* condition pill */}
      <div
        style={{
          margin: "0 auto",
          width: "fit-content",
          background: color,
          color: "white",
          padding: "10px 22px",
          borderRadius: 999,
          fontFamily: FONTS.sans,
          fontSize: 28,
          fontWeight: 900,
          marginBottom: 12,
          boxShadow: `0 8px 18px ${color}44`,
        }}
      >
        {conditionEmoji} {conditionLabel}
      </div>
      {/* result card */}
      <div
        style={{
          background: COLORS.paper,
          border: `3px solid ${highlight ? COLORS.green : color}`,
          borderRadius: 24,
          padding: "26px 18px",
          boxShadow: highlight
            ? "0 18px 42px rgba(22,163,74,0.32), 0 0 0 6px rgba(22,163,74,0.18)"
            : "0 14px 34px rgba(15,23,42,0.12)",
          fontFamily: FONTS.sans,
          textAlign: "center",
          position: "relative",
        }}
      >
        {highlight && (
          <div
            style={{
              position: "absolute",
              top: -16,
              right: -10,
              background: COLORS.green,
              color: "white",
              padding: "5px 12px",
              borderRadius: 999,
              fontSize: 18,
              fontWeight: 950,
              letterSpacing: 1,
              boxShadow: "0 8px 16px rgba(22,163,74,0.32)",
            }}
          >
            推荐
          </div>
        )}
        <div style={{ fontSize: 78, lineHeight: 1, marginBottom: 12 }}>{resultEmoji}</div>
        <div
          style={{
            fontSize: 42,
            fontWeight: 950,
            color: COLORS.ink,
            lineHeight: 1.2,
          }}
        >
          {resultText}
        </div>
      </div>
    </div>
  );
};

const SourceNote: React.FC = () => {
  const frame = useCurrentFrame();
  const s = svu08Plan.slots.sourceNote;
  if (frame < 268) return null;
  return (
    <PopIn startFrame={268} springConfig={SPRINGS.enter}>
      <div
        style={{
          ...rectStyle(s),
          zIndex: 12,
          borderLeft: `5px solid ${COLORS.blueDeep}`,
          borderRadius: 14,
          background: "rgba(255,255,255,0.78)",
          padding: "14px 18px",
          fontFamily: FONTS.sans,
          color: COLORS.inkSoft,
          boxShadow: "0 10px 28px rgba(15,23,42,0.08)",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 950, letterSpacing: 2, color: COLORS.inkFaint }}>
          适 用 人 群
        </div>
        <div style={{ fontSize: 22, fontWeight: 900, color: COLORS.ink, marginTop: 4 }}>
          普通人 · 没有医嘱情况下
        </div>
        <div style={{ fontSize: 17, marginTop: 4 }}>
          有处方/特殊病史另议
        </div>
      </div>
    </PopIn>
  );
};

// ─── Main composition ────────────────────────────────────────────
export const SVU08PlanDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const beats = svu08Plan.beats;
  const active = beats.find((b) => isBetween(frame, b.start, b.end))?.id;
  return (
    <AbsoluteFill style={{ background: COLORS.bg, overflow: "hidden" }}>
      <PageBackground />
      <ProgressStrip
        slot={svu08Plan.slots.topProgress}
        beats={[
          { id: "beat1_question", label: "提问" },
          { id: "beat2_branches", label: "分支" },
          { id: "beat3_results", label: "推荐" },
        ]}
        activeBeatId={active}
      />
      <TreeRoot />
      <TreeLines />
      <BranchCard
        slot={svu08Plan.slots.leftBranch}
        enterFrame={138}
        conditionLabel="规律吃鱼"
        conditionEmoji="✅"
        resultText="不必买鱼油"
        resultEmoji="🚫"
        color={COLORS.green}
        recommended={true}
      />
      <BranchCard
        slot={svu08Plan.slots.rightBranch}
        enterFrame={156}
        conditionLabel="几乎不吃"
        conditionEmoji="⚪"
        resultText="偶尔补一补"
        resultEmoji="🟡"
        color={COLORS.amber}
        recommended={false}
      />
      <SourceNote />
      <Presenter slot={svu08Plan.slots.presenterLeftBottom} frame={frame} size="small" />
      <RealSubtitle slot={svu08Plan.slots.subtitleBand} cues={svu08Plan.subtitles} frame={frame} />
      <PlatformChrome
        rightRail={svu08Plan.slots.rightRail}
        platformTitle={svu08Plan.slots.platformTitle}
      />
    </AbsoluteFill>
  );
};
