import { SAFE_AREA, SEMANTIC_COLORS, tintBg, withAlpha } from "./design-system";

export type SceneTone = "brand" | "info" | "warning" | "positive" | "neutral";

export const SCENE_TONE = {
  brand: {
    solid: SEMANTIC_COLORS.brand,
    soft: tintBg(SEMANTIC_COLORS.brand, 0.1),
    border: withAlpha(SEMANTIC_COLORS.brand, 0.26),
    glow: withAlpha(SEMANTIC_COLORS.brand, 0.24),
    gradient: `linear-gradient(135deg, ${withAlpha(SEMANTIC_COLORS.brand, 0.22)}, ${withAlpha(
      SEMANTIC_COLORS.info,
      0.12
    )})`,
  },
  info: {
    solid: SEMANTIC_COLORS.info,
    soft: tintBg(SEMANTIC_COLORS.info, 0.1),
    border: withAlpha(SEMANTIC_COLORS.info, 0.24),
    glow: withAlpha(SEMANTIC_COLORS.info, 0.2),
    gradient: `linear-gradient(135deg, ${withAlpha(SEMANTIC_COLORS.info, 0.2)}, rgba(255,255,255,0.78))`,
  },
  warning: {
    solid: SEMANTIC_COLORS.negative,
    soft: tintBg(SEMANTIC_COLORS.negative, 0.1),
    border: withAlpha(SEMANTIC_COLORS.negative, 0.28),
    glow: withAlpha(SEMANTIC_COLORS.negative, 0.24),
    gradient: `linear-gradient(135deg, ${withAlpha(SEMANTIC_COLORS.negative, 0.18)}, ${withAlpha(
      SEMANTIC_COLORS.highlight,
      0.12
    )})`,
  },
  positive: {
    solid: SEMANTIC_COLORS.positive,
    soft: tintBg(SEMANTIC_COLORS.positive, 0.1),
    border: withAlpha(SEMANTIC_COLORS.positive, 0.26),
    glow: withAlpha(SEMANTIC_COLORS.positive, 0.22),
    gradient: `linear-gradient(135deg, ${withAlpha(SEMANTIC_COLORS.positive, 0.16)}, ${withAlpha(
      SEMANTIC_COLORS.info,
      0.1
    )})`,
  },
  neutral: {
    solid: "#334155",
    soft: "rgba(255,255,255,0.68)",
    border: withAlpha("#0F172A", 0.1),
    glow: withAlpha("#0F172A", 0.08),
    gradient: "linear-gradient(135deg, rgba(255,255,255,0.92), rgba(255,255,255,0.72))",
  },
} as const satisfies Record<
  SceneTone,
  {
    solid: string;
    soft: string;
    border: string;
    glow: string;
    gradient: string;
  }
>;

export const VISUAL_SHELL = {
  overlayCompactWidth: 560,
  overlayPanelWidth: 680,
  overlayWideWidth: 780,
  graphicsPanelWidth: 920,
  sectionGap: 20,
  blockGap: 16,
  headerGap: 14,
  overlayTopOffset: 44,
  overlayBottomInset: 120,
  compactNavWidth: 352,
  compactNavTop: SAFE_AREA.top + 16,
  compactNavRight: SAFE_AREA.horizontal,
} as const;

export function tonePalette(tone: SceneTone = "brand") {
  return SCENE_TONE[tone];
}
