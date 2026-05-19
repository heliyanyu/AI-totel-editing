/**
 * SVU05 Motion Demo — Gallery focus + Magic Move + CountUp + PathDraw
 *
 * Based on V4 manual segmentation:
 *   - VU id: SVU05
 *   - duration: 18.6s (0-558 frames at 30fps)
 *   - attention_owner: board
 *   - beats:
 *       Beat 1 (frame 0-138)   "鱼油被奉为护心神药"
 *       Beat 2 (frame 138-294) "医生提醒：两个问题"
 *       Beat 3 (frame 294-558) "每多 1g 鱼油 → 房颤 +10%"
 *   - one_screen_message: "鱼油不是护心神药：房颤 +10%"
 *
 * Design language: v1 mockup (light blue glass cards, soft shadows, generous whitespace)
 *   - Icons are emoji (🐟 💓) for now; future swap with PNG / Nucleus stills
 *   - Real Nucleus afib video: 房颤-1.mp4 (1920×1080, 6.8s, looped to 18.6s)
 */

import React from "react";
import {
  AbsoluteFill,
  Easing,
  OffthreadVideo,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";

import {
  MagicMove,
  PopIn,
  StackReveal,
  CountUp,
  PathDraw,
  SPRINGS,
} from "./motion-primitives";

// ─── Layout & timing constants ──────────────────────────────────
const W = 1080;
const H = 1920;
const FPS = 30;
const TOTAL_FRAMES = Math.round(18.6 * FPS); // 558

// Beat boundaries (frames)
const BEAT1_START = 0;
const BEAT1_END = 138;   // 4.6s
const BEAT2_START = 138;
const BEAT2_END = 294;   // 9.8s
const BEAT3_START = 294;
const BEAT3_END = TOTAL_FRAMES;

// Cue points within Beat 3 (frames)
const HEART_ENTER = BEAT3_START + 12;   // ~10.2s
const NUMBER_START = BEAT3_START + 78;  // ~12.4s
const ECG_DRAW = BEAT3_START + 60;      // ~11.8s
const SOURCE_FADE_IN = BEAT3_START + 144; // ~14.1s
const QUOTE_POPIN = BEAT3_START + 198;    // ~15.9s

// ─── Design tokens (v1 mockup) ──────────────────────────────────
const C = {
  bg: "linear-gradient(160deg, #F6FAFF 0%, #ECF4FF 50%, #FBFEFF 100%)",
  paper: "rgba(255, 255, 255, 0.92)",
  paperGlass: "rgba(255, 255, 255, 0.78)",
  glassBorder: "rgba(255, 255, 255, 0.5)",
  brand: "#2563EB",
  positive: "#16A34A",
  negative: "#DC2626",
  highlight: "#F59E0B",
  info: "#0EA5E9",
  ink: "#0F172A",
  inkSoft: "#475569",
  inkFaint: "#94A3B8",
  hairline: "#CBD5E1",
};

const F = {
  sans: '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", -apple-system, sans-serif',
  serif: '"Noto Serif SC", "PingFang SC", serif',
  num: '"DIN Alternate", "Bahnschrift", "PingFang SC", sans-serif',
};

// ─── ECG path (atrial fibrillation: chaotic R-R intervals) ─────
const ECG_PATH = `
M 0 50
L 30 50
L 38 18
L 46 80
L 54 30
L 62 65
L 70 25
L 78 70
L 86 38
L 94 60
L 102 28
L 110 72
L 118 35
L 126 50
L 200 50
`.trim();

// ─── L1 navigator (top progress bar, two-tier) ─────────────────
const L1Navigator: React.FC = () => {
  const scenes = [
    { id: "S1", label: "开场" },
    { id: "S2", label: "鱼油" },
    { id: "S3", label: "牛初乳" },
    { id: "S4", label: "灵芝" },
    { id: "S5", label: "免疫力" },
    { id: "S6", label: "三件事" },
    { id: "S7", label: "收尾" },
  ];
  const beats = [
    { id: "登场", active: true },
    { id: "案例", active: false },
    { id: "出血", active: false },
    { id: "建议", active: false },
  ];
  return (
    <div
      style={{
        position: "absolute",
        top: 0, left: 0, right: 0,
        height: 200,
        background: "rgba(255, 255, 255, 0.88)",
        backdropFilter: "blur(10px)",
        borderBottom: `1px solid ${C.hairline}`,
        padding: "26px 60px",
        zIndex: 5,
      }}
    >
      {/* Tier 1 — scenes */}
      <div style={{ display: "flex", justifyContent: "center", gap: 8, alignItems: "center" }}>
        {scenes.map((s, i) => {
          const isActive = s.id === "S2";
          const isDone = i < 1;
          return (
            <React.Fragment key={s.id}>
              <span
                style={{
                  padding: "10px 18px",
                  borderRadius: 10,
                  background: isActive ? C.brand : isDone ? "#DBEAFE" : "#F1F5F9",
                  color: isActive ? "white" : isDone ? C.positive : C.inkSoft,
                  fontFamily: F.sans,
                  fontSize: 28,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                }}
              >
                {s.label}
              </span>
              {i < scenes.length - 1 && (
                <span style={{ color: C.hairline, fontSize: 18 }}>·</span>
              )}
            </React.Fragment>
          );
        })}
      </div>
      {/* Tier 2 — beats inside S2 */}
      <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 14 }}>
        {beats.map((b) => (
          <span
            key={b.id}
            style={{
              padding: "5px 14px",
              borderRadius: 6,
              background: b.active ? C.brand : "#F1F5F9",
              color: b.active ? "white" : C.inkFaint,
              fontFamily: F.sans,
              fontSize: 18,
              fontWeight: 600,
            }}
          >
            {b.id}
          </span>
        ))}
      </div>
    </div>
  );
};

// ─── L0 doctor placeholder (LEFT-BOTTOM half-body, like 孟祥恩 / 鹤立烟雨 layout) ──
// Real anchor pose: half-body crop, bottom-left corner, ~50% screen height
const L0DoctorPlaceholder: React.FC = () => (
  <div
    style={{
      position: "absolute",
      left: 0,
      top: 1080,
      width: 540,
      height: 620,
      borderTopRightRadius: 24,
      border: `3px dashed ${C.ink}`,
      borderBottomColor: "transparent",
      borderLeftColor: "transparent",
      background: "rgba(255, 255, 255, 0.30)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      zIndex: 3,
    }}
  >
    <div style={{ fontSize: 36, fontFamily: F.sans, fontWeight: 700, color: C.ink }}>
      主播半身像
    </div>
    <div style={{ fontSize: 22, fontFamily: F.sans, color: C.inkSoft }}>
      （chroma key 抠像后填入）
    </div>
  </div>
);

// ─── The L2 main stage (the running scene) ─────────────────────
const L2Stage: React.FC = () => {
  const frame = useCurrentFrame();

  // ─── Layout note ─────────────────────────────────────────────
  // Safe content area for short-video platforms (Douyin/Kuaishou):
  //   x: 30-940  (right ≥ 940 reserved for like/comment buttons)
  //   y: 90-1530 (top 80-90 = disclaimer; bottom 1620-1920 = title/comments)
  // Presenter (L0) is at left:  x 40-400, y 380-1100
  // L2 stage uses center-right zone: x 420-940
  // ─────────────────────────────────────────────────────────────

  // Fish oil emoji (Magic Move across 3 beats) — confined to center-right zone
  const fishOilStates = [
    { frame: 0, x: 700, y: 1100, scale: 0.3, opacity: 0 },                    // off-stage low-right
    { frame: 22, x: 700, y: 850, scale: 2.4, opacity: 1 },                    // hero entrance
    { frame: BEAT2_START + 6, x: 700, y: 850, scale: 2.4, opacity: 1 },       // hold
    { frame: BEAT2_START + 38, x: 800, y: 410, scale: 1.2, opacity: 1 },      // shrink to right-top
    { frame: BEAT3_START + 8, x: 800, y: 410, scale: 1.2, opacity: 1 },       // hold
    { frame: BEAT3_START + 36, x: 540, y: 920, scale: 1.4, opacity: 1 },      // move to pair-with-heart
    { frame: TOTAL_FRAMES, x: 540, y: 920, scale: 1.4, opacity: 1 },
  ];

  // Heart emoji — DEPRECATED in v5: Nucleus afib video now occupies the full right half
  // Real medical animation > emoji. Heart kept off-screen so Magic Move remains valid but invisible.
  const heartStates = [
    { frame: HEART_ENTER, x: 1100, y: 880, scale: 1.0, opacity: 0 },
    { frame: TOTAL_FRAMES, x: 1100, y: 880, scale: 1.0, opacity: 0 },
  ];

  return (
    <AbsoluteFill style={{ zIndex: 2 }}>
      {/* === Beat 1 floating label "护心神药？" — positioned below fish-oil in right half === */}
      {frame >= 30 && (
        <MagicMove
          states={[
            { frame: 30, x: 720, y: 880, scale: 1, opacity: 0 },
            { frame: 50, x: 720, y: 880, scale: 1, opacity: 1 },
            { frame: BEAT2_START + 18, x: 720, y: 880, scale: 1, opacity: 1 },
            { frame: BEAT2_START + 40, x: 720, y: 880, scale: 1, opacity: 0 },
          ]}
          springConfig={SPRINGS.glide}
        >
          <div
            style={{
              padding: "16px 32px",
              background: C.paper,
              borderRadius: 14,
              border: `2px solid ${C.brand}`,
              fontFamily: F.sans,
              fontSize: 56,
              fontWeight: 700,
              color: C.ink,
              boxShadow: "0 4px 12px rgba(37,99,235,0.15)",
              whiteSpace: "nowrap",
              position: "relative",
            }}
          >
            护心神药？
            {/* strike-through line that draws in during late beat 1 / start of beat 2 */}
            {frame >= BEAT2_START && (
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: -10,
                  height: 5,
                  width: `${Math.min(1, (frame - BEAT2_START) / 18) * 110}%`,
                  background: C.negative,
                  transform: "translateY(-50%)",
                  borderRadius: 3,
                }}
              />
            )}
          </div>
        </MagicMove>
      )}

      {/* === Beat 2 / 3: "两个问题" board — LEFT HALF (structure on left, materials on right) ===
            Beat 2: full-size in left zone (problems are the main message)
            Beat 3: collapse/shrink to make room for "+10%" big number — fold mechanism
            Frame-level interpolate + ease-out cubic (CSS transition does NOT work in Remotion!) */}
      {frame >= BEAT2_START + 12 && (() => {
        const COLLAPSE_START = BEAT3_START + 24;
        const COLLAPSE_END = BEAT3_START + 50;
        const collapseT = interpolate(
          frame,
          [COLLAPSE_START, COLLAPSE_END],
          [0, 1],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.out(Easing.cubic),
          }
        );
        const top = interpolate(collapseT, [0, 1], [480, 380]);
        const scale = interpolate(collapseT, [0, 1], [1, 0.62]);
        const opacity = interpolate(collapseT, [0, 1], [1, 0.85]);
        return (
        <div
          style={{
            position: "absolute",
            top,
            left: 30,
            width: 480,
            zIndex: 4,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            opacity,
          }}
        >
          <StackReveal
            startFrame={BEAT2_START + 24}
            staggerFrames={14}
            slideFrom="left"
            slideDistance={60}
          >
            <ProblemRow
              num={1}
              text="房颤风险"
              isActive={frame >= BEAT3_START + 8}
            />
            <div style={{ height: 14 }} />
            <ProblemRow
              num={2}
              text="出血叠加"
              isActive={false}
            />
          </StackReveal>
        </div>
        );
      })()}

      {/* === Beat 3: heart emoji + nucleus afib video + ECG === */}
      <MagicMove states={heartStates} springConfig={SPRINGS.glide}>
        <HeartGroup heartFrame={frame - HEART_ENTER} />
      </MagicMove>

      {/* === Beat 3: +10% giant number — LEFT HALF, below collapsed problems board === */}
      {frame >= NUMBER_START && (
        <div
          style={{
            position: "absolute",
            top: 580,
            left: 270,
            transform: "translateX(-50%)",
            zIndex: 5,
            textAlign: "center",
          }}
        >
          {/* prefix */}
          <PopIn startFrame={NUMBER_START} springConfig={SPRINGS.pop}>
            <div
              style={{
                fontFamily: F.sans,
                fontSize: 32,
                fontWeight: 600,
                color: C.inkSoft,
                marginBottom: -6,
              }}
            >
              每多 1g 鱼油
            </div>
          </PopIn>
          {/* the count-up "+10%" */}
          <PopIn startFrame={NUMBER_START + 6} springConfig={SPRINGS.pop} durationFrames={20}>
            <div
              style={{
                fontFamily: F.num,
                fontSize: 240,
                fontWeight: 800,
                color: C.negative,
                lineHeight: 1,
                letterSpacing: -4,
                textShadow: "0 6px 20px rgba(220,38,38,0.25)",
              }}
            >
              <span style={{ fontSize: 140 }}>+</span>
              <CountUp
                startFrame={NUMBER_START + 6}
                durationFrames={28}
                from={0}
                to={10}
              />
              <span style={{ fontSize: 140 }}>%</span>
            </div>
          </PopIn>
          {/* annotation */}
          <PopIn startFrame={NUMBER_START + 36} springConfig={SPRINGS.enter}>
            <div
              style={{
                fontFamily: F.sans,
                fontSize: 32,
                fontWeight: 600,
                color: C.ink,
                marginTop: 4,
              }}
            >
              房颤风险增量
            </div>
          </PopIn>
        </div>
      )}

      {/* === Beat 3 late: data source citation (small, right-aligned, low priority) === */}
      {frame >= SOURCE_FADE_IN && (
        <PopIn startFrame={SOURCE_FADE_IN} springConfig={SPRINGS.glide} durationFrames={24}
          style={{
            position: "absolute",
            top: 1500,
            left: 460,
            width: 480,
            zIndex: 4,
          }}
        >
          <div
            style={{
              padding: "14px 22px",
              background: C.paperGlass,
              borderRadius: 10,
              borderLeft: `4px solid ${C.brand}`,
              fontFamily: F.sans,
            }}
          >
            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: C.inkFaint,
                letterSpacing: 2,
                marginBottom: 4,
              }}
            >
              DATA SOURCE
            </div>
            <div style={{ fontSize: 22, color: C.ink, fontWeight: 600 }}>
              Gencer et al. Circulation 2021
            </div>
            <div style={{ fontSize: 18, color: C.inkSoft, marginTop: 2 }}>
              n=81,210 · meta-analysis
            </div>
          </div>
        </PopIn>
      )}
    </AbsoluteFill>
  );
};

// ─── Heart group: emoji heart + nucleus video + ECG path ───────
const HeartGroup: React.FC<{ heartFrame: number }> = ({ heartFrame }) => {
  return (
    <div style={{ position: "relative" }}>
      {/* heart emoji backdrop */}
      <div style={{ fontSize: 220, lineHeight: 1, textAlign: "center" }}>
        💓
      </div>
      {/* ECG SVG drawn over the heart */}
      {heartFrame >= ECG_DRAW - HEART_ENTER && (
        <svg
          width={220}
          height={120}
          viewBox="0 0 200 100"
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            pointerEvents: "none",
          }}
        >
          <PathDraw
            startFrame={ECG_DRAW}
            durationFrames={36}
            d={ECG_PATH}
            stroke="white"
            strokeWidth={4}
            pathLength={500}
          />
        </svg>
      )}
    </div>
  );
};

// ─── Beat 3 nucleus afib video — RIGHT HALF, full and unobstructed ─
const NucleusAfibBackdrop: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < BEAT3_START - 6) return null;

  const opacity = Math.min(1, Math.max(0, (frame - BEAT3_START) / 18));
  return (
    <div
      style={{
        position: "absolute",
        top: 380,
        left: 540,
        width: 500,
        height: 700,
        borderRadius: 14,
        overflow: "hidden",
        border: `3px solid ${C.highlight}`,
        boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
        opacity,
        zIndex: 1,
      }}
    >
      <OffthreadVideo
        src={staticFile("fangchan-1.mp4")}
        muted
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          padding: "5px 12px",
          background: C.highlight,
          color: "white",
          fontFamily: F.sans,
          fontSize: 20,
          fontWeight: 700,
          borderRadius: 5,
          letterSpacing: 1,
        }}
      >
        ★ NUCLEUS · 房颤心脏
      </div>
    </div>
  );
};

// ─── Real SRT-derived subtitle (Douyin-style: white bold + yellow keyword highlight) ──
// Hard-coded for SVU05 range (V0 demo); future will read from subtitles.srt automatically
interface SubLine {
  startFrame: number;
  endFrame: number;
  text: string;
  highlight?: string; // keyword to highlight in yellow
}
const SVU05_SUBS: SubLine[] = [
  { startFrame: 0,   endFrame: 70,  text: "鱼油在很多人心目中", highlight: "鱼油" },
  { startFrame: 70,  endFrame: 138, text: "简直就是 护心神药", highlight: "护心神药" },
  { startFrame: 153, endFrame: 230, text: "作为医生我得讲清楚", highlight: "医生" },
  { startFrame: 230, endFrame: 294, text: "鱼油天生有 两个大问题", highlight: "两个大问题" },
  { startFrame: 303, endFrame: 372, text: "第一 可能增加 房颤风险", highlight: "房颤风险" },
  { startFrame: 372, endFrame: 440, text: "有研究数据显示", highlight: "数据" },
  { startFrame: 440, endFrame: 558, text: "每多吃一克 房颤风险 增加百分之十", highlight: "百分之十" },
];

const RealSubtitle: React.FC = () => {
  const frame = useCurrentFrame();
  const cur = SVU05_SUBS.find((s) => frame >= s.startFrame && frame < s.endFrame);
  if (!cur) return null;

  // split text by highlight keyword
  const parts: { text: string; hl: boolean }[] = [];
  if (cur.highlight && cur.text.includes(cur.highlight)) {
    const idx = cur.text.indexOf(cur.highlight);
    if (idx > 0) parts.push({ text: cur.text.slice(0, idx), hl: false });
    parts.push({ text: cur.highlight, hl: true });
    if (idx + cur.highlight.length < cur.text.length) {
      parts.push({ text: cur.text.slice(idx + cur.highlight.length), hl: false });
    }
  } else {
    parts.push({ text: cur.text, hl: false });
  }

  return (
    <div
      style={{
        position: "absolute",
        bottom: 200,        // above platform-bottom safe zone but in subtitle zone
        left: 0,
        right: 0,
        textAlign: "center",
        zIndex: 7,
        fontFamily: F.sans,
        fontSize: 44,
        fontWeight: 900,
        letterSpacing: 2,
        textShadow: "0 0 8px rgba(0,0,0,0.6), 2px 2px 0 #000",
        WebkitTextStroke: "1.5px #000",
      }}
    >
      {parts.map((p, i) => (
        <span
          key={i}
          style={{
            color: p.hl ? "#FFD60A" : "white",
          }}
        >
          {p.text}
        </span>
      ))}
    </div>
  );
};

// ─── Disclaimer at very BOTTOM (compliance only — meant to be obscured by Douyin title bar) ──
const BottomDisclaimer: React.FC = () => (
  <div
    style={{
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      padding: "8px 60px",
      color: "rgba(0, 0, 0, 0.45)",
      fontFamily: F.sans,
      fontSize: 16,
      fontWeight: 400,
      textAlign: "center",
      letterSpacing: 0.5,
      zIndex: 1,
    }}
  >
    医学科普 仅供参考 · 如有不适请线下就诊 · 具体目标值需根据心血管疾病风险确定
  </div>
);

// ─── Q/A subtitle (replaces L3 emphasis — Douyin-style left Q/A badge + caption bar) ───
const QASubtitleBar: React.FC = () => {
  const frame = useCurrentFrame();
  let badge = "Q";
  let badgeBg = C.highlight;
  let text = "鱼油真的护心吗？";
  let frameStart = 30;

  if (frame >= BEAT2_START + 18 && frame < BEAT3_START + 60) {
    badge = "A";
    badgeBg = C.brand;
    text = "医生提醒：天生有两个问题";
    frameStart = BEAT2_START + 18;
  } else if (frame >= BEAT3_START + 60) {
    badge = "A";
    badgeBg = C.negative;
    text = "每多 1g 鱼油 → 房颤风险 +10%";
    frameStart = BEAT3_START + 60;
  }

  return (
    <div
      style={{
        position: "absolute",
        // Q/A title belongs at TOP — title goes top, not bottom
        top: 220,
        left: 30,
        right: 180,    // leave 180px on the right for platform like/comment column
        zIndex: 6,
      }}
    >
      <PopIn startFrame={frameStart} springConfig={SPRINGS.pop}>
        <div style={{ display: "flex", alignItems: "stretch", boxShadow: "0 8px 20px rgba(0,0,0,0.18)" }}>
          {/* badge */}
          <div
            style={{
              width: 84,
              background: badgeBg,
              color: "white",
              fontFamily: F.num,
              fontSize: 56,
              fontWeight: 900,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "12px 0 0 12px",
            }}
          >
            {badge}
          </div>
          {/* caption */}
          <div
            style={{
              flex: 1,
              background: C.brand,
              color: "white",
              fontFamily: F.sans,
              fontSize: 42,
              fontWeight: 800,
              padding: "18px 24px",
              borderRadius: "0 12px 12px 0",
              letterSpacing: 1,
              display: "flex",
              alignItems: "center",
            }}
          >
            {text}
          </div>
        </div>
      </PopIn>
    </div>
  );
};

// ─── Helper: Problem row in the "two problems" board ───────────
const ProblemRow: React.FC<{ num: number; text: string; isActive: boolean }> = ({
  num,
  text,
  isActive,
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 14,
      padding: "18px 22px",
      background: isActive ? "#FEF3C7" : C.paper,
      borderRadius: 14,
      border: isActive ? `3px solid ${C.highlight}` : `2px solid ${C.hairline}`,
      boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
      transition: "all 0.3s ease",
    }}
  >
    <div
      style={{
        width: 56,
        height: 56,
        borderRadius: "50%",
        background: isActive ? C.highlight : C.inkFaint,
        color: "white",
        fontFamily: F.num,
        fontSize: 32,
        fontWeight: 800,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {num}
    </div>
    <div
      style={{
        fontFamily: F.sans,
        fontSize: 36,
        fontWeight: 700,
        color: isActive ? C.ink : C.inkSoft,
      }}
    >
      问题 {num}：{text}
    </div>
  </div>
);

// ─── Fish oil emoji at canvas-coordinates (managed by MagicMove) ─
const FishOilEmoji: React.FC = () => (
  <div
    style={{
      fontSize: 120,
      lineHeight: 1,
      filter: "drop-shadow(0 8px 20px rgba(245,158,11,0.35))",
    }}
  >
    🐟
  </div>
);

// ─── Main composition ─────────────────────────────────────────
export const SVU05Motion: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily: F.sans }}>
      {/* L2 background: nucleus afib video (top-right, only during beat 3) */}
      <NucleusAfibBackdrop />

      {/* L2 stage: fish oil emoji
          Beat 1: hero center (right half — left will hold title later)
          Beat 2: shrink to top of left half (paired with problems board appearance)
          Beat 3: linger as small icon at top-left, letting +10% number dominate */}
      <MagicMove
        states={[
          { frame: 0, x: 720, y: 720, scale: 0.3, opacity: 0 },
          { frame: 22, x: 720, y: 600, scale: 2.4, opacity: 1 },
          { frame: BEAT2_START + 6, x: 720, y: 600, scale: 2.4, opacity: 1 },
          { frame: BEAT2_START + 38, x: 720, y: 320, scale: 0.85, opacity: 0.9 },
          { frame: BEAT3_START + 8, x: 720, y: 320, scale: 0.85, opacity: 0 },    // hand-off to nucleus
          { frame: TOTAL_FRAMES, x: 720, y: 320, scale: 0.85, opacity: 0 },
        ]}
        springConfig={SPRINGS.glide}
      >
        <FishOilEmoji />
      </MagicMove>

      <L2Stage />

      {/* L0 doctor placeholder (left-bottom half-body) */}
      <L0DoctorPlaceholder />

      {/* L1 navigator (top below disclaimer) */}
      <L1Navigator />

      {/* Disclaimer at very bottom (compliance only, ok to be covered by platform title bar) */}
      <BottomDisclaimer />

      {/* SRT-derived real subtitle (above platform-bottom UI, white bold + yellow highlight) */}
      <RealSubtitle />

      {/* dev: frame counter */}
      <div
        style={{
          position: "absolute",
          bottom: 16,
          left: 16,
          fontFamily: F.num,
          fontSize: 16,
          color: C.inkFaint,
          opacity: 0.4,
          zIndex: 10,
        }}
      >
        {frame} / {TOTAL_FRAMES}
      </div>
    </AbsoluteFill>
  );
};

// ─── Platform UI safe-zone hint (dev/QA only — shows where Douyin UI lives) ─
const PlatformUIHint: React.FC = () => (
  <>
    {/* right column: like / collect / comment / share */}
    <div
      style={{
        position: "absolute",
        right: 0, top: 380,
        width: 140, height: 1080,
        borderLeft: "1px dashed rgba(0,0,0,0.15)",
        background: "rgba(0,0,0,0.02)",
        zIndex: 1,
        pointerEvents: "none",
      }}
    />
    <div
      style={{
        position: "absolute",
        right: 14, top: 396,
        fontFamily: F.sans,
        fontSize: 14,
        color: "rgba(0,0,0,0.25)",
        zIndex: 1,
        textAlign: "right",
        lineHeight: 1.4,
      }}
    >
      平台 UI<br />
      点赞 / 收藏<br />
      评论 / 分享
    </div>
    {/* bottom: video title + comment input */}
    <div
      style={{
        position: "absolute",
        left: 0, right: 0, bottom: 0,
        height: 280,
        borderTop: "1px dashed rgba(0,0,0,0.15)",
        background: "rgba(0,0,0,0.02)",
        zIndex: 1,
        pointerEvents: "none",
      }}
    />
    <div
      style={{
        position: "absolute",
        left: 30, bottom: 120,
        fontFamily: F.sans,
        fontSize: 14,
        color: "rgba(0,0,0,0.3)",
        zIndex: 1,
      }}
    >
      平台底部 · 视频标题 / 用户名 / 评论入口
    </div>
  </>
);
