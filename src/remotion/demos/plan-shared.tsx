// Shared building blocks for all SVU plan demos.
// Includes:
//   - design tokens (colors, fonts, page background)
//   - PlatformChrome (bottom disclaimer only; platform action rail is reserved but not drawn)
//   - Presenter (reserved slot only; no placeholder is drawn)
//   - RealSubtitle (Douyin-style highlighted subtitle)
//
// Each family-specific demo (SVU05PlanDemo / SVU07PlanDemo / ...) imports from here.

import React from "react";

// ─── Design tokens ───────────────────────────────────────────────
export const COLORS = {
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
  greenSoft: "#D1FAE5",
  slate: "#1E293B",
  purple: "#7C3AED",
};

export const FONTS = {
  sans: '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif',
  num: '"DIN Alternate", "Bahnschrift", "Microsoft YaHei", sans-serif',
};

export const PAGE_BG_GRADIENT =
  "linear-gradient(180deg, #F8FAFC 0%, #EAF2FF 46%, #DDEBFF 100%), radial-gradient(circle at 72% 26%, rgba(14,165,233,0.2), transparent 32%)";

// ─── Generic slot rect helper ────────────────────────────────────
export interface SlotRect {
  x: number;
  y: number;
  w: number;
  h: number;
  description?: string;
}

export const rectStyle = (r: SlotRect): React.CSSProperties => ({
  position: "absolute",
  left: r.x,
  top: r.y,
  width: r.w,
  height: r.h,
});

export const isBetween = (frame: number, start: number, end: number) =>
  frame >= start && frame < end;

// ─── Platform chrome (bottom title bar only) ─────────────────────
export const PlatformChrome: React.FC<{
  rightRail: SlotRect;
  platformTitle: SlotRect;
}> = ({ platformTitle }) => (
  <>
    <div
      style={{
        ...rectStyle(platformTitle),
        zIndex: 38,
        background: "linear-gradient(180deg, rgba(15,23,42,0), rgba(15,23,42,0.72))",
        color: "rgba(255,255,255,0.44)",
        fontFamily: FONTS.sans,
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

// ─── Presenter reserved slot ─────────────────────────────────────
export const Presenter: React.FC<{
  slot: SlotRect;
  frame: number;
  size?: "small" | "medium";
}> = () => null;

// ─── Real SRT-style subtitle band ────────────────────────────────
export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
  highlight: string;
}

export const RealSubtitle: React.FC<{
  slot: SlotRect;
  cues: readonly SubtitleCue[];
  frame: number;
}> = ({ slot, cues, frame }) => {
  const cue =
    cues.find((item) => isBetween(frame, item.start, item.end)) ??
    cues[cues.length - 1];
  const parts = cue.text.split(cue.highlight);
  return (
    <div
      style={{
        ...rectStyle(slot),
        zIndex: 30,
        display: "grid",
        placeItems: "center",
        textAlign: "center",
        fontFamily: FONTS.sans,
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

// ─── Top progress strip — two tiers (chapter chips + beat chips) ─
export const ProgressStrip: React.FC<{
  slot: SlotRect;
  beats: readonly { id: string; label: string }[];
  activeBeatId: string | undefined;
  beatColor?: string;
  activeChapter?: string;
}> = ({ slot, beats, activeBeatId, beatColor = COLORS.blue, activeChapter = "鱼油" }) => (
  <div
    style={{
      ...rectStyle(slot),
      zIndex: 18,
      borderRadius: 18,
      background: "rgba(255,255,255,0.84)",
      border: "1px solid rgba(148,163,184,0.24)",
      boxShadow: "0 10px 30px rgba(15,23,42,0.08)",
      padding: "16px 22px",
      fontFamily: FONTS.sans,
    }}
  >
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      {["开场", "鱼油", "牛初乳", "灵芝", "免疫力", "三件事", "收尾"].map((item) => {
        const isCurrent = item === activeChapter;
        const isPast =
          ["开场", "鱼油", "牛初乳", "灵芝", "免疫力", "三件事", "收尾"].indexOf(item) <
          ["开场", "鱼油", "牛初乳", "灵芝", "免疫力", "三件事", "收尾"].indexOf(
            activeChapter
          );
        return (
          <div
            key={item}
            style={{
              height: 32,
              padding: "0 13px",
              borderRadius: 7,
              display: "grid",
              placeItems: "center",
              background: isCurrent ? COLORS.blueDeep : isPast ? "#DBEAFE" : "#F8FAFC",
              color: isCurrent ? "#FFFFFF" : isPast ? COLORS.green : COLORS.inkSoft,
              fontSize: 18,
              fontWeight: 850,
            }}
          >
            {item}
          </div>
        );
      })}
    </div>
    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
      {beats.map((chip) => {
        const isActive = chip.id === activeBeatId;
        return (
          <div
            key={chip.id}
            style={{
              flex: 1,
              height: 28,
              borderRadius: 6,
              background: isActive ? beatColor : "#E2E8F0",
              boxShadow: isActive ? `0 0 18px ${beatColor}66` : undefined,
              display: "grid",
              placeItems: "center",
              color: isActive ? "white" : COLORS.inkSoft,
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

// ─── Page background wrapper ─────────────────────────────────────
export const PageBackground: React.FC = () => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      background: PAGE_BG_GRADIENT,
    }}
  />
);
