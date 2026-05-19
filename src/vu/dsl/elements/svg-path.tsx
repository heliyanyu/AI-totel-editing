import React from "react";

import type { ElementSnapshot } from "../interpreter";
import type { SvgPathElement, SvgPathPreset } from "../schema";

interface PresetSpec {
  d: string;
  viewBox: string;
  width: number;
  height: number;
  pathLength: number;
  defaultStroke: string;
  defaultStrokeWidth: number;
}

const PRESETS: Record<SvgPathPreset, PresetSpec> = {
  ecg_chaotic: {
    d:
      "M 0 50 L 30 50 L 38 18 L 46 80 L 54 30 L 62 65 L 70 25 L 78 70 L 86 38 L 94 60 L 102 28 L 110 72 L 118 35 L 126 50 L 200 50",
    viewBox: "0 0 200 100",
    width: 360,
    height: 200,
    pathLength: 500,
    defaultStroke: "#FFFFFF",
    defaultStrokeWidth: 5,
  },
  arrow_right: {
    d: "M 10 50 L 170 50 M 150 30 L 170 50 L 150 70",
    viewBox: "0 0 200 100",
    width: 320,
    height: 160,
    pathLength: 280,
    defaultStroke: "#DC2626",
    defaultStrokeWidth: 6,
  },
  curve_up: {
    d: "M 10 80 Q 100 0 190 80",
    viewBox: "0 0 200 100",
    width: 320,
    height: 160,
    pathLength: 260,
    defaultStroke: "#16A34A",
    defaultStrokeWidth: 6,
  },
  curve_down: {
    d: "M 10 20 Q 100 100 190 20",
    viewBox: "0 0 200 100",
    width: 320,
    height: 160,
    pathLength: 260,
    defaultStroke: "#DC2626",
    defaultStrokeWidth: 6,
  },
};

export const SvgPathView: React.FC<{ el: SvgPathElement; snap: ElementSnapshot }> = ({
  el,
  snap,
}) => {
  const preset = el.preset ? PRESETS[el.preset] : null;
  const d = el.d ?? preset?.d ?? "";
  const viewBox = preset?.viewBox ?? "0 0 200 100";
  const width = preset?.width ?? 320;
  const height = preset?.height ?? 160;
  const pathLength = preset?.pathLength ?? 500;
  const stroke = el.stroke ?? preset?.defaultStroke ?? "#DC2626";
  const strokeWidth = el.stroke_width ?? preset?.defaultStrokeWidth ?? 5;
  const progress = snap.pathProgress;

  return (
    <svg width={width} height={height} viewBox={viewBox} style={{ pointerEvents: "none" }}>
      <path
        d={d}
        stroke={stroke}
        strokeWidth={strokeWidth}
        fill="none"
        strokeDasharray={pathLength}
        strokeDashoffset={pathLength * (1 - progress)}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
