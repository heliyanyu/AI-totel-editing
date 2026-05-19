import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

import { CountUp, MagicMove, PathDraw, PopIn, SPRINGS } from "./motion-primitives";
import { type Svu07SlotName, type SlotRect, svu07MotionPlan } from "./svu07-motion-plan";

const W = 1080;
const H = 1920;

const C = {
  bg: "#F1F5F9",
  paper: "#FFFFFF",
  ink: "#0F172A",
  inkSoft: "#475569",
  inkFaint: "#94A3B8",
  line: "#CBD5E1",
  blue: "#0EA5E9",
  blueDeep: "#2563EB",
  red: "#DC2626",
  redDeep: "#7F1D1D",
  amber: "#F59E0B",
  amberSoft: "#FEF3C7",
  green: "#16A34A",
  slate: "#1E293B",
};

const F = {
  sans: '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif',
  num: '"DIN Alternate", "Bahnschrift", "Microsoft YaHei", sans-serif',
};

const SHOW_SLOT_DEBUG = false;

const slot = (name: Svu07SlotName): SlotRect => svu07MotionPlan.slots[name];
const isBetween = (frame: number, start: number, end: number) =>
  frame >= start && frame < end;

const rect = (r: SlotRect): React.CSSProperties => ({
  position: "absolute",
  left: r.x,
  top: r.y,
  width: r.w,
  height: r.h,
});

// ────────────────────────────────────────────────────────────────
// Platform safe-zone chrome (right rail bottom-only + bottom title)
// ────────────────────────────────────────────────────────────────
const PlatformChrome: React.FC = () => {
  const title = slot("platformTitle");
  return (
    <>
      <div
        style={{
          ...rect(title),
          zIndex: 38,
          background: "linear-gradient(180deg, rgba(15,23,42,0), rgba(15,23,42,0.72))",
          color: "rgba(255,255,255,0.44)",
          fontFamily: F.sans,
          fontSize: 18,
          display: "flex",
          alignItems: "flex-end",
          padding: "0 36px 20px",
          pointerEvents: "none",
        }}
      >
        医学科普仅供参考，具体诊疗请线下就诊
      </div>
    </>
  );
};

// ────────────────────────────────────────────────────────────────
// Top progress strip — full-width, two-tier (scenes + beats)
// ────────────────────────────────────────────────────────────────
const ProgressStrip: React.FC = () => {
  const frame = useCurrentFrame();
  const s = slot("topProgress");
  const beats = svu07MotionPlan.beats;
  const active = beats.find((beat) => isBetween(frame, beat.start, beat.end))?.id;
  return (
    <div
      style={{
        ...rect(s),
        zIndex: 18,
        borderRadius: 18,
        background: "rgba(255,255,255,0.84)",
        border: "1px solid rgba(148,163,184,0.24)",
        boxShadow: "0 10px 30px rgba(15,23,42,0.08)",
        padding: "16px 22px",
        fontFamily: F.sans,
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {["开场", "鱼油", "牛初乳", "灵芝", "免疫力", "三件事", "收尾"].map((item) => (
          <div
            key={item}
            style={{
              height: 32,
              padding: "0 13px",
              borderRadius: 7,
              display: "grid",
              placeItems: "center",
              background:
                item === "鱼油" ? C.blueDeep : item === "开场" ? "#DBEAFE" : "#F8FAFC",
              color: item === "鱼油" ? "#FFFFFF" : item === "开场" ? C.green : C.inkSoft,
              fontSize: 18,
              fontWeight: 850,
            }}
          >
            {item}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        {[
          { id: "beat1_drugs", label: "药物入栈" },
          { id: "beat2_addfish", label: "再叠鱼油" },
          { id: "beat3_risk", label: "出血风险" },
        ].map((chip) => {
          const isActive = chip.id === active;
          return (
            <div
              key={chip.id}
              style={{
                flex: 1,
                height: 28,
                borderRadius: 6,
                background: isActive ? C.red : "#E2E8F0",
                boxShadow: isActive ? "0 0 18px rgba(220,38,38,0.38)" : undefined,
                display: "grid",
                placeItems: "center",
                color: isActive ? "white" : C.inkSoft,
                fontSize: 16,
                fontWeight: 850,
                letterSpacing: 1,
              }}
            >
              {chip.label}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ────────────────────────────────────────────────────────────────
// Stack header — beat 1: "正在吃这些药？"; beat 2: "再加鱼油"
// ────────────────────────────────────────────────────────────────
const StackHeader: React.FC = () => {
  const frame = useCurrentFrame();
  const s = slot("stackHeader");

  const inBeat1 = frame < 130;
  const inBeat2 = frame >= 130 && frame < 220;

  // Beat 1 header
  const beat1Opacity = interpolate(frame, [0, 16, 124, 138], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // Beat 2 header
  const beat2Opacity = interpolate(frame, [128, 146, 214, 228], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  if (frame >= 220) return null;

  return (
    <div
      style={{
        ...rect(s),
        zIndex: 12,
        display: "grid",
        placeItems: "center",
        fontFamily: F.sans,
      }}
    >
      {inBeat1 || frame < 138 ? (
        <div
          style={{
            opacity: beat1Opacity,
            fontSize: 56,
            fontWeight: 950,
            color: C.ink,
            letterSpacing: 3,
            textAlign: "center",
          }}
        >
          正在吃<span style={{ color: C.red }}>这些药</span>？
        </div>
      ) : null}
      {inBeat2 || (frame >= 128 && frame < 228) ? (
        <div
          style={{
            position: "absolute",
            opacity: beat2Opacity,
            fontSize: 64,
            fontWeight: 950,
            color: C.ink,
            letterSpacing: 4,
            textAlign: "center",
          }}
        >
          再 加 <span style={{ color: C.amber }}>鱼 油</span>
        </div>
      ) : null}
    </div>
  );
};

// ────────────────────────────────────────────────────────────────
// Pill card — generic anticoagulant/antiplatelet visual
// ────────────────────────────────────────────────────────────────
interface PillCardProps {
  name: string;
  category: string;
  color: string;
  emoji: string;
}
const PillCard: React.FC<PillCardProps> = ({ name, category, color, emoji }) => (
  <div
    style={{
      width: "100%",
      height: 124,
      borderRadius: 18,
      background: C.paper,
      border: `2px solid ${C.line}`,
      boxShadow: "0 12px 28px rgba(15,23,42,0.10)",
      padding: "0 24px",
      display: "flex",
      alignItems: "center",
      gap: 18,
      fontFamily: F.sans,
      position: "relative",
      overflow: "hidden",
    }}
  >
    {/* left color stripe */}
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        bottom: 0,
        width: 8,
        background: color,
      }}
    />
    {/* icon circle */}
    <div
      style={{
        marginLeft: 8,
        width: 88,
        height: 88,
        borderRadius: "50%",
        background: `${color}22`,
        display: "grid",
        placeItems: "center",
        fontSize: 56,
        flexShrink: 0,
      }}
    >
      {emoji}
    </div>
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 38, fontWeight: 950, color: C.ink }}>{name}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: C.inkSoft, marginTop: 4 }}>
        {category}
      </div>
    </div>
  </div>
);

// ────────────────────────────────────────────────────────────────
// Pill stack — 3 drugs + fish oil entered with stagger
// ────────────────────────────────────────────────────────────────
const PillStack: React.FC = () => {
  const frame = useCurrentFrame();
  const s = slot("pillStack");
  const { fps } = useVideoConfig();

  // Each pill's stagger entry frame (+ duration)
  const entries = [
    { id: "aspirin", enterFrame: 14, name: "阿司匹林", category: "抗血小板", color: C.red, emoji: "💊" },
    { id: "clopidogrel", enterFrame: 50, name: "氯吡格雷", category: "抗血小板", color: C.amber, emoji: "💊" },
    { id: "rivaroxaban", enterFrame: 90, name: "利伐沙班", category: "抗凝", color: C.blueDeep, emoji: "💊" },
  ];

  const fishEnter = 144;

  // Beat-2 stack glow ring around the whole stack
  const glowOpacity = interpolate(frame, [136, 156, 210, 230], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Beat-3 stack folds (shifts up + shrinks slightly) to leave room for risk bars
  const foldT = interpolate(frame, [218, 256], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const stackTop = interpolate(foldT, [0, 1], [s.y + 80, s.y + 30]);
  const stackScale = interpolate(foldT, [0, 1], [1, 0.86]);

  return (
    <div
      style={{
        position: "absolute",
        left: s.x,
        top: stackTop,
        width: s.w,
        zIndex: 8,
        transform: `scale(${stackScale})`,
        transformOrigin: "top left",
      }}
    >
      {/* glow ring */}
      <div
        style={{
          position: "absolute",
          inset: -16,
          borderRadius: 30,
          opacity: glowOpacity,
          boxShadow: "0 0 0 4px rgba(245,158,11,0.55), 0 24px 60px rgba(245,158,11,0.32)",
          pointerEvents: "none",
        }}
      />

      {/* drugs in order, bottom-up visual but rendered top-down for simpler stacking */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* fish oil on TOP of the stack (rendered first since CSS stacking) */}
        <PillEntry enterFrame={fishEnter} fps={fps}>
          <FishOilCard />
        </PillEntry>
        {[...entries].reverse().map((e) => (
          <PillEntry key={e.id} enterFrame={e.enterFrame} fps={fps}>
            <PillCard
              name={e.name}
              category={e.category}
              color={e.color}
              emoji={e.emoji}
            />
          </PillEntry>
        ))}
      </div>
    </div>
  );
};

const PillEntry: React.FC<{
  enterFrame: number;
  fps: number;
  children: React.ReactNode;
}> = ({ enterFrame, fps, children }) => {
  const frame = useCurrentFrame();
  const local = frame - enterFrame;
  if (local < -2) return null;
  const t = spring({
    frame: Math.max(0, local),
    fps,
    config: SPRINGS.enter,
    durationInFrames: 22,
  });
  const opacity = interpolate(local, [0, 8], [0, 1], { extrapolateRight: "clamp" });
  const dy = interpolate(t, [0, 1], [42, 0]);
  return (
    <div
      style={{
        opacity,
        transform: `translateY(${dy}px)`,
        willChange: "transform, opacity",
      }}
    >
      {children}
    </div>
  );
};

const FishOilCard: React.FC = () => (
  <div
    style={{
      width: "100%",
      height: 124,
      borderRadius: 18,
      background: "linear-gradient(135deg, #FEF3C7 0%, #FED7AA 100%)",
      border: `3px solid ${C.amber}`,
      boxShadow: "0 16px 42px rgba(245,158,11,0.32)",
      padding: "0 24px",
      display: "flex",
      alignItems: "center",
      gap: 18,
      fontFamily: F.sans,
      position: "relative",
      overflow: "hidden",
    }}
  >
    <div
      style={{
        marginLeft: 8,
        width: 88,
        height: 88,
        fontSize: 80,
        display: "grid",
        placeItems: "center",
      }}
    >
      🐟
    </div>
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 38, fontWeight: 950, color: C.ink }}>+ 鱼油</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: C.inkSoft, marginTop: 4 }}>
        被叠加
      </div>
    </div>
    <div
      style={{
        position: "absolute",
        right: 18,
        top: 14,
        background: C.red,
        color: "white",
        padding: "4px 14px",
        borderRadius: 999,
        fontSize: 18,
        fontWeight: 900,
        letterSpacing: 1,
      }}
    >
      触发
    </div>
  </div>
);

// ────────────────────────────────────────────────────────────────
// Risk bars zone — beat 3
// ────────────────────────────────────────────────────────────────
const RiskBars: React.FC = () => {
  const frame = useCurrentFrame();
  const s = slot("riskZone");
  if (frame < 218) return null;

  return (
    <div
      style={{
        ...rect(s),
        zIndex: 9,
        fontFamily: F.sans,
      }}
    >
      <PopIn startFrame={218} springConfig={SPRINGS.enter}>
        <div
          style={{
            fontSize: 26,
            fontWeight: 950,
            color: C.red,
            letterSpacing: 2,
            marginBottom: 14,
          }}
        >
          ↑ 出 血 风 险
        </div>
      </PopIn>
      <RiskBar
        label="胃出血"
        startFrame={236}
        targetWidth={0.78}
        color="linear-gradient(90deg, #FCD34D 0%, #DC2626 100%)"
      />
      <div style={{ height: 18 }} />
      <RiskBar
        label="脑出血"
        startFrame={258}
        targetWidth={0.55}
        color="linear-gradient(90deg, #FCA5A5 0%, #B91C1C 100%)"
      />
    </div>
  );
};

const RiskBar: React.FC<{
  label: string;
  startFrame: number;
  targetWidth: number; // 0..1
  color: string;
}> = ({ label, startFrame, targetWidth, color }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [startFrame, startFrame + 36], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const fillW = t * targetWidth * 100;
  // count-up the percent display as the bar fills
  const pct = Math.round(t * targetWidth * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, fontFamily: F.sans }}>
      <div
        style={{
          width: 110,
          fontSize: 28,
          fontWeight: 900,
          color: C.ink,
          textAlign: "right",
        }}
      >
        {label}
      </div>
      <div
        style={{
          flex: 1,
          height: 38,
          borderRadius: 999,
          background: "#E2E8F0",
          overflow: "hidden",
          border: `1px solid ${C.line}`,
        }}
      >
        <div
          style={{
            width: `${fillW}%`,
            height: "100%",
            background: color,
            borderRadius: 999,
            transition: "none",
          }}
        />
      </div>
      <div
        style={{
          width: 90,
          fontFamily: F.num,
          fontSize: 32,
          fontWeight: 950,
          color: C.red,
          textAlign: "left",
        }}
      >
        {pct}%
      </div>
    </div>
  );
};

// ────────────────────────────────────────────────────────────────
// Source note — small mechanism caption (right of presenter)
// ────────────────────────────────────────────────────────────────
const SourceNote: React.FC = () => {
  const frame = useCurrentFrame();
  const s = slot("sourceNote");
  if (frame < 320) return null;
  return (
    <PopIn startFrame={320} springConfig={SPRINGS.enter}>
      <div
        style={{
          ...rect(s),
          zIndex: 12,
          borderLeft: `5px solid ${C.red}`,
          borderRadius: 14,
          background: "rgba(255,255,255,0.78)",
          padding: "14px 18px",
          fontFamily: F.sans,
          color: C.inkSoft,
          boxShadow: "0 10px 28px rgba(15,23,42,0.08)",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 950, letterSpacing: 2, color: C.inkFaint }}>
          MECHANISM
        </div>
        <div style={{ fontSize: 22, fontWeight: 900, color: C.ink, marginTop: 4 }}>
          叠加抑制 凝血/血小板 通路
        </div>
        <div style={{ fontSize: 17, marginTop: 4 }}>
          多重药理协同，止血代偿被打掉
        </div>
      </div>
    </PopIn>
  );
};

// ────────────────────────────────────────────────────────────────
// Presenter placeholder
// ────────────────────────────────────────────────────────────────
const Presenter: React.FC = () => null;

// ────────────────────────────────────────────────────────────────
// Real subtitle band — same SRT-style render as SVU05
// ────────────────────────────────────────────────────────────────
const RealSubtitle: React.FC = () => {
  const frame = useCurrentFrame();
  const s = slot("subtitleBand");
  const cue =
    svu07MotionPlan.subtitles.find((item) => isBetween(frame, item.start, item.end)) ??
    svu07MotionPlan.subtitles[svu07MotionPlan.subtitles.length - 1];
  const parts = cue.text.split(cue.highlight);
  return (
    <div
      style={{
        ...rect(s),
        zIndex: 30,
        display: "grid",
        placeItems: "center",
        textAlign: "center",
        fontFamily: F.sans,
        fontSize: 43,
        lineHeight: 1.18,
        fontWeight: 950,
        color: "#FFFFFF",
        whiteSpace: "pre-line",
        textShadow:
          "0 4px 0 rgba(0,0,0,0.86), 0 -2px 0 rgba(0,0,0,0.86), 2px 0 0 rgba(0,0,0,0.86), -2px 0 0 rgba(0,0,0,0.86), 0 12px 24px rgba(0,0,0,0.42)",
      }}
    >
      <div>
        {parts.length > 1 ? (
          <>
            {parts[0]}
            <span style={{ color: "#FACC15" }}>{cue.highlight}</span>
            {parts.slice(1).join(cue.highlight)}
          </>
        ) : (
          cue.text
        )}
      </div>
    </div>
  );
};

const SlotDebug: React.FC = () => (
  <>
    {(["pillStack", "riskZone", "subtitleBand", "rightRail"] as Svu07SlotName[]).map((name) => {
      const s = slot(name);
      return (
        <div
          key={name}
          style={{
            ...rect(s),
            zIndex: 3,
            border: "1px dashed rgba(220,38,38,0.25)",
            borderRadius: 16,
            color: "rgba(220,38,38,0.4)",
            fontFamily: F.sans,
            fontSize: 16,
            padding: 8,
            pointerEvents: "none",
          }}
        >
          {name}
        </div>
      );
    })}
  </>
);

// ────────────────────────────────────────────────────────────────
// Main composition
// ────────────────────────────────────────────────────────────────
export const SVU07PlanDemo: React.FC = () => (
  <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
    <div
      style={{
        position: "absolute",
        inset: 0,
        background:
          "linear-gradient(180deg, #F8FAFC 0%, #EAF2FF 46%, #DDEBFF 100%), radial-gradient(circle at 72% 26%, rgba(14,165,233,0.2), transparent 32%)",
      }}
    />
    {SHOW_SLOT_DEBUG && <SlotDebug />}
    <ProgressStrip />
    <StackHeader />
    <PillStack />
    <RiskBars />
    <SourceNote />
    <Presenter />
    <RealSubtitle />
    <PlatformChrome />
  </AbsoluteFill>
);
