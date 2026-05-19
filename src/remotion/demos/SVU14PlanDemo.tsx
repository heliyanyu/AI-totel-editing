// SVU14 — presentation_family: concept_balance
// V4 spec: id=SVU14, time=141.04-176.48s (35.44s, 1063 frames), attention_owner=mixed
// one_screen_message: "免疫力要平衡，不是拉高"
// internal_beats:
//   1. "你真的需要提高免疫力吗？" (口播主导)
//   2. "不是越高越好" (向上箭头被打断)
//   3. "太低易病，太高乱攻" (仪表盘)
//   4. "免疫过强，也会伤身" (三种自免病浮现)
//   5. "目标是稳，不是拉高" (指针回到中绿区)

import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

import { PopIn, SPRINGS, StackReveal } from "./motion-primitives";
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

export const svu14Plan = {
  id: "SVU14",
  title: "免疫力要平衡，不是拉高",
  presentationFamily: "concept_balance",
  durationFrames: 1063,
  fps: 30,
  rules: [
    "the gauge is the conceptual core; everything else orbits it.",
    "the up-arrow in beat 2 must visibly break/snap, never just fade.",
    "auto-immune diseases enter from the 'high' side of the gauge to anchor causality.",
    "needle returns to center in beat 5 with a soft settle, signalling the resolution.",
  ],
  slots: {
    topProgress: { x: 28, y: 28, w: 1024, h: 114 },
    questionStage: { x: 60, y: 220, w: 960, h: 340 },
    gaugeArea: { x: 90, y: 460, w: 900, h: 540 },
    diseasesList: { x: 60, y: 1030, w: 960, h: 280 },
    presenterLeftBottom: { x: 30, y: 1370, w: 280, h: 340 },
    sourceNote: { x: 350, y: 1370, w: 540, h: 130 },
    subtitleBand: { x: 44, y: 1490, w: 850, h: 130 },
    platformTitle: { x: 0, y: 1788, w: 1080, h: 132 },
    rightRail: { x: 940, y: 1100, w: 140, h: 600 },
  } satisfies Record<string, SlotRect>,
  beats: [
    { id: "b1_question", start: 0, end: 156, goal: "ask: do you really need to boost immunity?" },
    { id: "b2_break", start: 156, end: 320, goal: "break the 'higher is better' arrow" },
    { id: "b3_gauge", start: 320, end: 600, goal: "introduce balance gauge with low/high consequences" },
    { id: "b4_diseases", start: 600, end: 850, goal: "auto-immune diseases as too-high consequence" },
    { id: "b5_lock", start: 850, end: 1063, goal: "lock the message: aim for balance, not high" },
  ],
  subtitles: [
    { start: 0, end: 100, text: "三个坑说完了", highlight: "三个坑" },
    { start: 100, end: 156, text: "你真的需要\n提高免疫力吗？", highlight: "提高免疫力" },
    { start: 156, end: 254, text: "太多人把免疫力\n当成越高越好", highlight: "越高越好" },
    { start: 254, end: 320, text: "这个观点其实\n是错的", highlight: "是错的" },
    { start: 320, end: 460, text: "免疫力讲究的\n是平衡", highlight: "平衡" },
    { start: 460, end: 568, text: "太低 容易感冒生病", highlight: "太低" },
    { start: 568, end: 680, text: "太高 它就开始乱来了", highlight: "太高" },
    { start: 680, end: 760, text: "连你自己身体的\n正常组织都攻击", highlight: "攻击" },
    { start: 760, end: 850, text: "类风湿、红斑狼疮、\n桥本", highlight: "类风湿" },
    { start: 850, end: 950, text: "免疫系统太亢奋了\n六亲不认", highlight: "六亲不认" },
    { start: 950, end: 1063, text: "目标是稳\n不是拉高", highlight: "稳" },
  ] satisfies SubtitleCue[],
} as const;

// Beat 1: hero question card
const QuestionStage: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame >= 156) return null;
  const opacity = interpolate(frame, [0, 16, 140, 156], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        ...rectStyle(svu14Plan.slots.questionStage),
        zIndex: 10,
        display: "grid",
        placeItems: "center",
        opacity,
      }}
    >
      <PopIn startFrame={4} springConfig={SPRINGS.enter}>
        <div
          style={{
            background: COLORS.paper,
            border: `4px solid ${COLORS.blueDeep}`,
            borderRadius: 24,
            padding: "36px 60px",
            boxShadow: "0 22px 50px rgba(37,99,235,0.22)",
            fontFamily: FONTS.sans,
            fontSize: 70,
            fontWeight: 950,
            textAlign: "center",
            color: COLORS.ink,
            letterSpacing: 3,
            lineHeight: 1.15,
          }}
        >
          你真的需要<br />
          <span style={{ color: COLORS.blueDeep }}>提高免疫力</span> 吗？
        </div>
      </PopIn>
    </div>
  );
};

// Beat 2: up-arrow that snaps in half
const BreakingArrow: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < 156 || frame >= 320) return null;
  const enter = spring({
    frame: Math.max(0, frame - 156),
    fps: 30,
    config: SPRINGS.enter,
    durationInFrames: 24,
  });
  const breakFrame = 240;
  // After breakFrame the arrow tip falls + rotates
  const breakT = interpolate(frame, [breakFrame, breakFrame + 26], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.cubic),
  });
  const fadeOut = interpolate(frame, [300, 320], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        left: 540,
        top: 700,
        zIndex: 11,
        transform: `translate(-50%, -50%)`,
        opacity: enter * fadeOut,
        fontFamily: FONTS.sans,
      }}
    >
      <svg width={420} height={520} viewBox="0 0 420 520">
        <defs>
          <linearGradient id="arrow-grad" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor={COLORS.amber} />
            <stop offset="100%" stopColor={COLORS.red} />
          </linearGradient>
        </defs>
        {/* shaft (lower part) */}
        <rect x={170} y={180} width={80} height={300} fill="url(#arrow-grad)" rx={6} />
        {/* tip (upper part) — translates+rotates after break */}
        <g
          transform={`translate(${breakT * 110}, ${breakT * 80}) rotate(${breakT * 38} 210 100)`}
        >
          <polygon points="210,40 320,180 250,180 250,180 170,180 100,180" fill={COLORS.red} />
          {/* crack line */}
          {breakT > 0.1 && (
            <line
              x1={120}
              y1={180}
              x2={300}
              y2={180}
              stroke="white"
              strokeWidth={6}
              strokeDasharray="14,8"
            />
          )}
        </g>
        {/* X mark across breaking moment */}
        {frame >= breakFrame && (
          <g transform="translate(50 60)">
            <line
              x1={0}
              y1={0}
              x2={120 * Math.min(1, (frame - breakFrame) / 14)}
              y2={120 * Math.min(1, (frame - breakFrame) / 14)}
              stroke={COLORS.red}
              strokeWidth={18}
              strokeLinecap="round"
            />
            <line
              x1={0}
              y1={120}
              x2={120 * Math.min(1, (frame - breakFrame) / 14)}
              y2={120 - 120 * Math.min(1, (frame - breakFrame) / 14)}
              stroke={COLORS.red}
              strokeWidth={18}
              strokeLinecap="round"
            />
          </g>
        )}
      </svg>
      <div
        style={{
          textAlign: "center",
          marginTop: -20,
          fontSize: 46,
          fontWeight: 950,
          color: COLORS.red,
          textShadow: "0 4px 0 white",
        }}
      >
        不是 越高越好
      </div>
    </div>
  );
};

// Beats 3-5: the balance gauge with needle
const BalanceGauge: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < 320) return null;
  const enter = spring({
    frame: Math.max(0, frame - 320),
    fps: 30,
    config: SPRINGS.glide,
    durationInFrames: 30,
  });

  // Needle position:
  // beat3 (320-600): drift from center to left (0.2) then right (0.8)
  // beat4 (600-850): hold on right (0.85)
  // beat5 (850-1063): return smoothly to center 0.5
  let needleT: number; // 0 = far left, 0.5 = center, 1 = far right
  if (frame < 460) {
    needleT = interpolate(frame, [320, 460], [0.5, 0.18], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.inOut(Easing.cubic),
    });
  } else if (frame < 600) {
    needleT = interpolate(frame, [460, 600], [0.18, 0.85], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.inOut(Easing.cubic),
    });
  } else if (frame < 850) {
    needleT = 0.85;
  } else {
    needleT = interpolate(frame, [850, 970], [0.85, 0.5], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    });
  }
  // Translate needleT to angle: -90deg = far left, 0 = center, 90deg = far right
  const angle = (needleT - 0.5) * 180;

  const slot = svu14Plan.slots.gaugeArea;
  const cx = slot.x + slot.w / 2;
  const cy = slot.y + slot.h - 60;
  const r = 360;

  return (
    <div style={{ ...rectStyle(slot), zIndex: 9, opacity: Math.min(1, enter) }}>
      <svg width={slot.w} height={slot.h} viewBox={`0 0 ${slot.w} ${slot.h}`}>
        <defs>
          <linearGradient id="gauge-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#DC2626" />
            <stop offset="32%" stopColor="#FCA5A5" />
            <stop offset="46%" stopColor="#22C55E" />
            <stop offset="54%" stopColor="#22C55E" />
            <stop offset="68%" stopColor="#FCA5A5" />
            <stop offset="100%" stopColor="#DC2626" />
          </linearGradient>
        </defs>
        {/* gauge arc (half-circle, thickness 80px) */}
        <path
          d={`M ${slot.w / 2 - r} ${slot.h - 60} A ${r} ${r} 0 0 1 ${slot.w / 2 + r} ${slot.h - 60}`}
          fill="none"
          stroke="url(#gauge-grad)"
          strokeWidth={70}
          strokeLinecap="butt"
        />
        {/* tick markers */}
        {[0, 0.5, 1].map((p) => (
          <line
            key={p}
            x1={slot.w / 2 + Math.cos(Math.PI + Math.PI * p) * (r + 8)}
            y1={slot.h - 60 + Math.sin(Math.PI + Math.PI * p) * (r + 8)}
            x2={slot.w / 2 + Math.cos(Math.PI + Math.PI * p) * (r - 50)}
            y2={slot.h - 60 + Math.sin(Math.PI + Math.PI * p) * (r - 50)}
            stroke={COLORS.ink}
            strokeWidth={4}
          />
        ))}
        {/* needle */}
        <g transform={`translate(${slot.w / 2} ${slot.h - 60}) rotate(${angle - 90})`}>
          <line
            x1={0}
            y1={0}
            x2={0}
            y2={-r + 30}
            stroke={COLORS.ink}
            strokeWidth={10}
            strokeLinecap="round"
          />
          <circle cx={0} cy={0} r={20} fill={COLORS.ink} />
          <polygon points={`-14,-${r - 30} 14,-${r - 30} 0,-${r}`} fill={COLORS.ink} />
        </g>
      </svg>
      {/* zone labels */}
      <div
        style={{
          position: "absolute",
          left: 30,
          top: 180,
          fontFamily: FONTS.sans,
          fontSize: 38,
          fontWeight: 950,
          color: COLORS.red,
          textAlign: "center",
        }}
      >
        太低<br />
        <span style={{ fontSize: 22, color: COLORS.inkSoft, fontWeight: 700 }}>
          容易感冒生病
        </span>
      </div>
      <div
        style={{
          position: "absolute",
          left: "50%",
          transform: "translateX(-50%)",
          top: 60,
          fontFamily: FONTS.sans,
          fontSize: 44,
          fontWeight: 950,
          color: COLORS.green,
          textAlign: "center",
          letterSpacing: 4,
        }}
      >
        ★ 平 衡 ★
      </div>
      <div
        style={{
          position: "absolute",
          right: 30,
          top: 180,
          fontFamily: FONTS.sans,
          fontSize: 38,
          fontWeight: 950,
          color: COLORS.red,
          textAlign: "center",
        }}
      >
        太高<br />
        <span style={{ fontSize: 22, color: COLORS.inkSoft, fontWeight: 700 }}>
          自身组织被攻击
        </span>
      </div>
    </div>
  );
};

// Beat 4: 3 auto-immune diseases enter
const DiseasesList: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < 600) return null;
  const slot = svu14Plan.slots.diseasesList;
  const items = [
    { emoji: "🦴", name: "类风湿性关节炎" },
    { emoji: "🌡️", name: "红斑狼疮" },
    { emoji: "🦋", name: "桥本甲状腺炎" },
  ];
  return (
    <div style={{ ...rectStyle(slot), zIndex: 11 }}>
      <div
        style={{
          fontFamily: FONTS.sans,
          fontSize: 26,
          fontWeight: 950,
          color: COLORS.red,
          letterSpacing: 2,
          marginBottom: 14,
        }}
      >
        ↑ 太 高 的 代 价
      </div>
      <div style={{ display: "flex", gap: 20 }}>
        <StackReveal startFrame={618} staggerFrames={20} slideFrom="right" slideDistance={50}>
          {items.map((it) => (
            <div
              key={it.name}
              style={{
                flex: 1,
                background: COLORS.paper,
                border: `3px solid ${COLORS.red}`,
                borderRadius: 18,
                padding: "16px 12px",
                textAlign: "center",
                fontFamily: FONTS.sans,
                boxShadow: "0 10px 26px rgba(220,38,38,0.18)",
              }}
            >
              <div style={{ fontSize: 56, lineHeight: 1, marginBottom: 6 }}>{it.emoji}</div>
              <div style={{ fontSize: 30, fontWeight: 950, color: COLORS.ink }}>{it.name}</div>
            </div>
          ))}
        </StackReveal>
      </div>
    </div>
  );
};

// Beat 5: lock-in label
const LockMessage: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < 850) return null;
  return (
    <PopIn startFrame={850} springConfig={SPRINGS.pop}>
      <div
        style={{
          position: "absolute",
          left: 60,
          width: 820,
          top: 1330,
          textAlign: "center",
          zIndex: 14,
          fontFamily: FONTS.sans,
          fontSize: 44,
          fontWeight: 950,
          color: "white",
          background: COLORS.green,
          padding: "16px 28px",
          borderRadius: 14,
          boxShadow: "0 14px 30px rgba(22,163,74,0.32)",
          letterSpacing: 2,
        }}
      >
        目标是 <span style={{ color: "#FACC15", fontSize: 56 }}>稳</span>，不是拉高
      </div>
    </PopIn>
  );
};

export const SVU14PlanDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const beats = svu14Plan.beats;
  const active = beats.find((b) => isBetween(frame, b.start, b.end))?.id;
  return (
    <AbsoluteFill style={{ background: COLORS.bg, overflow: "hidden" }}>
      <PageBackground />
      <ProgressStrip
        slot={svu14Plan.slots.topProgress}
        beats={[
          { id: "b1_question", label: "提问" },
          { id: "b2_break", label: "断裂" },
          { id: "b3_gauge", label: "仪表" },
          { id: "b4_diseases", label: "病例" },
          { id: "b5_lock", label: "锁定" },
        ]}
        activeBeatId={active}
        beatColor={COLORS.green}
        activeChapter="免疫力"
      />
      <QuestionStage />
      <BreakingArrow />
      <BalanceGauge />
      <DiseasesList />
      <LockMessage />
      <Presenter slot={svu14Plan.slots.presenterLeftBottom} frame={frame} size="small" />
      <RealSubtitle slot={svu14Plan.slots.subtitleBand} cues={svu14Plan.subtitles} frame={frame} />
      <PlatformChrome
        rightRail={svu14Plan.slots.rightRail}
        platformTitle={svu14Plan.slots.platformTitle}
      />
    </AbsoluteFill>
  );
};
