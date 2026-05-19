export const COLORS = {
  brand: "#2563EB",
  brandDeep: "#1D4ED8",
  positive: "#16A34A",
  negative: "#DC2626",
  warning: "#F59E0B",
  info: "#0EA5E9",
  ink: "#0F172A",
  inkSoft: "#475569",
  inkFaint: "#94A3B8",
  hairline: "#CBD5E1",
  paper: "rgba(255,255,255,0.92)",
  paperGlass: "rgba(255,255,255,0.78)",
};

export const FONTS = {
  sans: '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", -apple-system, sans-serif',
  serif: '"Noto Serif SC", "PingFang SC", serif',
  num: '"DIN Alternate", "Bahnschrift", "PingFang SC", sans-serif',
};

export interface ToneStyle {
  fg: string;
  bg: string;
  border: string;
  glow: string;
}

export function toneStyle(tone?: string): ToneStyle {
  switch (tone) {
    case "danger":
      return { fg: COLORS.negative, bg: "#FEE2E2", border: COLORS.negative, glow: "rgba(220,38,38,0.25)" };
    case "positive":
      return { fg: COLORS.positive, bg: "#DCFCE7", border: COLORS.positive, glow: "rgba(22,163,74,0.25)" };
    case "warning":
      return { fg: COLORS.warning, bg: "#FEF3C7", border: COLORS.warning, glow: "rgba(245,158,11,0.25)" };
    case "brand":
      return { fg: COLORS.brand, bg: "#DBEAFE", border: COLORS.brand, glow: "rgba(37,99,235,0.20)" };
    case "info":
      return { fg: COLORS.info, bg: "#E0F2FE", border: COLORS.info, glow: "rgba(14,165,233,0.25)" };
    case "neutral":
    default:
      return { fg: COLORS.ink, bg: COLORS.paper, border: COLORS.hairline, glow: "rgba(15,23,42,0.10)" };
  }
}
