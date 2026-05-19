import React from "react";
import {
  AbsoluteFill,
  Loop,
  OffthreadVideo,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

import { CountUp, MagicMove, PathDraw, PopIn, SPRINGS, StackReveal } from "./motion-primitives";
import { type SlotName, type SlotRect, svu05MotionPlan } from "./svu05-motion-plan";

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
  amber: "#F59E0B",
  green: "#16A34A",
  slate: "#1E293B",
};

const F = {
  sans: '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif',
  num: '"DIN Alternate", "Bahnschrift", "Microsoft YaHei", sans-serif',
};

const SHOW_SLOT_DEBUG = false;

const ECG_PATH =
  "M 0 48 L 24 48 L 32 18 L 40 78 L 49 30 L 58 66 L 66 22 L 76 72 L 84 36 L 94 61 L 103 28 L 113 70 L 122 35 L 132 48 L 190 48";

const slot = (name: SlotName): SlotRect => svu05MotionPlan.slots[name];
const isBetween = (frame: number, start: number, end: number) => frame >= start && frame < end;
const opacityRange = (frame: number, input: [number, number, number, number]) =>
  interpolate(frame, input, [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

const rect = (r: SlotRect): React.CSSProperties => ({
  position: "absolute",
  left: r.x,
  top: r.y,
  width: r.w,
  height: r.h,
});

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

const ProgressStrip: React.FC = () => {
  const frame = useCurrentFrame();
  const s = slot("topProgress");
  const beats = svu05MotionPlan.beats;
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
        padding: "18px 22px",
        fontFamily: F.sans,
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {["开场", "鱼油", "牛初乳", "灵芝", "免疫力", "三件事", "收尾"].map((item) => (
          <div
            key={item}
            style={{
              height: 34,
              padding: "0 13px",
              borderRadius: 7,
              display: "grid",
              placeItems: "center",
              background: item === "鱼油" ? C.blueDeep : item === "开场" ? "#DBEAFE" : "#F8FAFC",
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
          { id: "beat1_claim", label: "登场" },
          { id: "beat2_flag", label: "立 flag" },
          { id: "beat3_evidence", label: "数据爆点" },
        ].map((chip) => {
          const isActive = chip.id === active;
          return (
            <div
              key={chip.id}
              style={{
                flex: 1,
                height: 28,
                borderRadius: 6,
                background: isActive ? C.blue : "#E2E8F0",
                boxShadow: isActive ? "0 0 18px rgba(14,165,233,0.38)" : undefined,
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

// Hero question card for Beat 1 — centered, with fish-oil icon embedded, gets crossed out at end
const ClaimCard: React.FC = () => {
  const frame = useCurrentFrame();
  const s = slot("centerHero");
  const opacity = opacityRange(frame, [0, 24, 108, 138]);
  return (
    <div
      style={{
        ...rect(s),
        opacity,
        zIndex: 8,
        display: "grid",
        placeItems: "center",
      }}
    >
      <PopIn startFrame={10} springConfig={SPRINGS.enter}>
        <div
          style={{
            position: "relative",
            borderRadius: 28,
            background: C.paper,
            border: `1px solid ${C.line}`,
            boxShadow: "0 30px 80px rgba(15,23,42,0.18)",
            padding: "60px 80px 56px",
            fontFamily: F.sans,
            textAlign: "center",
            minWidth: 720,
          }}
        >
          <div style={{ color: C.inkFaint, fontSize: 30, fontWeight: 850, marginBottom: 18, letterSpacing: 4 }}>
            大众印象
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 28,
            }}
          >
            <div
              style={{
                fontSize: 160,
                lineHeight: 1,
                filter: "drop-shadow(0 14px 28px rgba(245,158,11,0.32))",
              }}
            >
              🐟
            </div>
            <div
              style={{
                color: C.ink,
                fontSize: 92,
                lineHeight: 1.05,
                fontWeight: 950,
                textAlign: "left",
              }}
            >
              是<br />
              <span style={{ color: C.blueDeep }}>护心神药</span>
              <span style={{ color: C.red, fontSize: 110 }}>？</span>
            </div>
          </div>
        </div>
      </PopIn>
    </div>
  );
};

// Big red X drawn diagonally across the hero card in the final 1.5s of Beat 1
const CrossMark: React.FC = () => {
  const frame = useCurrentFrame();
  const s = slot("centerHero");
  // Cross draws from frame 96 → 132, two strokes
  const tA = interpolate(frame, [96, 116], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const tB = interpolate(frame, [110, 130], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = interpolate(frame, [96, 110, 130, 138], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  if (frame < 96 || frame > 138) return null;

  // Two strokes drawn as line segments inside the slot's central region
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2 + 30; // slightly below center to overlap the question text
  const reach = 280; // half-length of each cross stroke
  return (
    <svg
      width={W}
      height={H}
      style={{ position: "absolute", inset: 0, zIndex: 14, opacity, pointerEvents: "none" }}
    >
      <defs>
        <filter id="crossglow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* stroke A: top-left → bottom-right */}
      <line
        x1={cx - reach}
        y1={cy - reach}
        x2={cx - reach + tA * (reach * 2)}
        y2={cy - reach + tA * (reach * 2)}
        stroke={C.red}
        strokeWidth={26}
        strokeLinecap="round"
        filter="url(#crossglow)"
      />
      {/* stroke B: top-right → bottom-left */}
      <line
        x1={cx + reach}
        y1={cy - reach}
        x2={cx + reach - tB * (reach * 2)}
        y2={cy - reach + tB * (reach * 2)}
        stroke={C.red}
        strokeWidth={26}
        strokeLinecap="round"
        filter="url(#crossglow)"
      />
    </svg>
  );
};

const ProblemBoard: React.FC = () => {
  const frame = useCurrentFrame();
  const s = slot("leftStructure");
  const enter = spring({
    frame: frame - 148,
    fps: 30,
    config: SPRINGS.enter,
    durationInFrames: 26,
  });
  const folded = interpolate(frame, [294, 330], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const scale = interpolate(folded, [0, 1], [1, 0.72]);
  const top = interpolate(folded, [0, 1], [s.y + 240, s.y + 28]);
  const x = s.x + 8;
  const opacity = frame < 138 ? 0 : 1;
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top,
        width: s.w - 16,
        transform: `scale(${scale}) translateY(${interpolate(enter, [0, 1], [32, 0])}px)`,
        transformOrigin: "top left",
        opacity: opacity * Math.min(1, enter),
        zIndex: 10,
        fontFamily: F.sans,
      }}
    >
      <div
        style={{
          borderRadius: 18,
          background: "rgba(255,255,255,0.92)",
          border: `1px solid ${C.line}`,
          boxShadow: "0 12px 34px rgba(15,23,42,0.12)",
          padding: "18px",
        }}
      >
        <div style={{ color: C.inkFaint, fontSize: 20, fontWeight: 850, marginBottom: 12 }}>
          医生提醒：两个问题
        </div>
        <StackReveal startFrame={156} staggerFrames={15} slideFrom="left" slideDistance={34}>
          <ProblemRow index={1} text="房颤风险" active={frame >= 306} />
          <ProblemRow index={2} text="出血叠加" active={false} />
        </StackReveal>
      </div>
    </div>
  );
};

const ProblemRow: React.FC<{ index: number; text: string; active: boolean }> = ({ index, text, active }) => (
  <div
    style={{
      height: 68,
      marginTop: index === 1 ? 0 : 12,
      borderRadius: 14,
      background: active ? "#FEF3C7" : "#F8FAFC",
      border: `2px solid ${active ? C.amber : "#E2E8F0"}`,
      display: "flex",
      alignItems: "center",
      gap: 13,
      padding: "0 16px",
      color: active ? C.ink : C.inkSoft,
      fontSize: 28,
      fontWeight: 900,
    }}
  >
    <span
      style={{
        width: 42,
        height: 42,
        borderRadius: "50%",
        background: active ? C.amber : "#94A3B8",
        color: "#FFFFFF",
        display: "grid",
        placeItems: "center",
        fontFamily: F.num,
      }}
    >
      {index}
    </span>
    问题{index}：{text}
  </div>
);

const TenPercent: React.FC = () => {
  const frame = useCurrentFrame();
  const s = slot("leftStructure");
  if (frame < 300) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: s.x + 20,
        top: s.y + 430,
        width: s.w - 40,
        zIndex: 12,
        textAlign: "left",
        fontFamily: F.sans,
      }}
    >
      <PopIn startFrame={304} springConfig={SPRINGS.pop}>
        <div style={{ color: C.inkSoft, fontSize: 28, fontWeight: 850 }}>每多 1g 鱼油</div>
      </PopIn>
      <PopIn startFrame={324} springConfig={SPRINGS.pop} durationFrames={22}>
        <div
          style={{
            color: C.red,
            fontFamily: F.num,
            fontSize: 160,
            lineHeight: 0.95,
            fontWeight: 950,
            textShadow: "0 12px 30px rgba(220,38,38,0.16)",
          }}
        >
          +<CountUp startFrame={326} durationFrames={28} from={0} to={10} />%
        </div>
      </PopIn>
      <PopIn startFrame={360} springConfig={SPRINGS.enter}>
        <div
          style={{
            marginTop: 4,
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            borderRadius: 999,
            background: "#FEE2E2",
            color: "#991B1B",
            padding: "9px 15px",
            fontSize: 28,
            fontWeight: 950,
          }}
        >
          房颤风险增量
        </div>
      </PopIn>
      <svg width={330} height={86} viewBox="0 0 190 80" style={{ marginTop: 14, opacity: 0.82 }}>
        <PathDraw
          startFrame={380}
          durationFrames={34}
          d={ECG_PATH}
          stroke={C.red}
          strokeWidth={5}
          pathLength={520}
        />
      </svg>
    </div>
  );
};

const FishOilIcon: React.FC = () => (
  <div
    style={{
      fontSize: 118,
      lineHeight: 1,
      filter: "drop-shadow(0 14px 24px rgba(245,158,11,0.28))",
    }}
  >
    🐟
  </div>
);

// Beat 1's fish-oil is rendered INSIDE the hero ClaimCard (centered with the question).
// MovingFishOil only handles Beat 2+ (small icon at top-right of evidence area, then folds away in Beat 3).
const MovingFishOil: React.FC = () => {
  const left = slot("leftStructure");
  const right = slot("rightEvidence");
  return (
    <MagicMove
      states={[
        // Beat 1: stay hidden (hero card has its own fish-oil)
        { frame: 0, x: right.x + right.w - 84, y: right.y + 86, scale: 0.9, opacity: 0 },
        { frame: 138, x: right.x + right.w - 84, y: right.y + 86, scale: 0.9, opacity: 0 },
        { frame: 156, x: right.x + right.w - 84, y: right.y + 86, scale: 0.9, opacity: 1 },
        { frame: 300, x: right.x + right.w - 84, y: right.y + 86, scale: 0.9, opacity: 1 },
        { frame: 342, x: left.x + 340, y: left.y + 740, scale: 0.78, opacity: 0.9 },
        { frame: svu05MotionPlan.durationFrames, x: left.x + 340, y: left.y + 740, scale: 0.78, opacity: 0.9 },
      ]}
      springConfig={SPRINGS.glide}
    >
      <FishOilIcon />
    </MagicMove>
  );
};

const AfibEvidence: React.FC = () => {
  const frame = useCurrentFrame();
  const s = slot("rightEvidence");
  const enter = spring({
    frame: frame - 300,
    fps: 30,
    config: SPRINGS.glide,
    durationInFrames: 34,
  });
  if (frame < 288) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: s.x,
        top: s.y + 140,
        width: s.w,
        height: 620,
        zIndex: 9,
        transform: `translateX(${interpolate(enter, [0, 1], [52, 0])}px)`,
        opacity: Math.min(1, enter),
      }}
    >
      <div
        style={{
          borderRadius: 22,
          overflow: "hidden",
          width: "100%",
          height: "100%",
          background: C.slate,
          border: "3px solid rgba(245,158,11,0.82)",
          boxShadow: "0 20px 48px rgba(15,23,42,0.22)",
        }}
      >
        <Loop durationInFrames={204}>
          <OffthreadVideo
            src={staticFile("fangchan-1.mp4")}
            muted
            style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center" }}
          />
        </Loop>
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: -44,
          color: C.inkSoft,
          fontFamily: F.sans,
          fontSize: 22,
          fontWeight: 850,
        }}
      >
        证据素材：房颤心脏动画
      </div>
    </div>
  );
};

const SourceNote: React.FC = () => {
  const frame = useCurrentFrame();
  const s = slot("sourceNote");
  if (frame < 420) return null;
  return (
    <PopIn startFrame={420} springConfig={SPRINGS.enter}>
      <div
        style={{
          ...rect(s),
          zIndex: 12,
          borderLeft: `5px solid ${C.blueDeep}`,
          borderRadius: 14,
          background: "rgba(255,255,255,0.78)",
          padding: "16px 20px",
          fontFamily: F.sans,
          color: C.inkSoft,
          boxShadow: "0 10px 28px rgba(15,23,42,0.08)",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 950, letterSpacing: 2, color: C.inkFaint }}>
          DATA SOURCE
        </div>
        <div style={{ fontSize: 24, fontWeight: 900, color: C.ink, marginTop: 4 }}>
          Meta-analysis · 81,210 participants
        </div>
        <div style={{ fontSize: 19, marginTop: 4 }}>来源小字独占 source slot，不压字幕。</div>
      </div>
    </PopIn>
  );
};

const Presenter: React.FC = () => null;

const RealSubtitle: React.FC = () => {
  const frame = useCurrentFrame();
  const s = slot("subtitleBand");
  const cue =
    svu05MotionPlan.subtitles.find((item) => isBetween(frame, item.start, item.end)) ??
    svu05MotionPlan.subtitles[svu05MotionPlan.subtitles.length - 1];
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
    {(["leftStructure", "rightEvidence", "subtitleBand"] as SlotName[]).map((name) => {
      const s = slot(name);
      return (
        <div
          key={name}
          style={{
            ...rect(s),
            zIndex: 3,
            border: "1px dashed rgba(14,165,233,0.2)",
            borderRadius: 16,
            color: "rgba(14,165,233,0.28)",
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

export const SVU05PlanDemo: React.FC = () => (
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
    <ClaimCard />
    <CrossMark />
    <ProblemBoard />
    <TenPercent />
    <MovingFishOil />
    <AfibEvidence />
    <SourceNote />
    <Presenter />
    <RealSubtitle />
    <PlatformChrome />
  </AbsoluteFill>
);
