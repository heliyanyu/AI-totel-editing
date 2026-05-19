import React from "react";

import type { ElementSnapshot } from "../interpreter";
import type { TextCardElement } from "../schema";
import { COLORS, FONTS, toneStyle } from "./tokens";

export const TextCardView: React.FC<{ el: TextCardElement; snap: ElementSnapshot }> = ({
  el,
  snap,
}) => {
  const tone = toneStyle(el.tone);
  const lines = el.text.split(/\\n|\n/);
  const longest = Math.max(...lines.map((line) => line.length));
  const fontSize = longest <= 8 ? 56 : longest <= 14 ? 46 : longest <= 20 ? 38 : 32;
  return (
    <div
      style={{
        position: "relative",
        padding: "16px 32px",
        background: COLORS.paper,
        borderRadius: 14,
        border: `2px solid ${tone.border}`,
        fontFamily: FONTS.sans,
        fontSize,
        fontWeight: 700,
        lineHeight: 1.25,
        color: COLORS.ink,
        boxShadow: `0 4px 12px ${tone.glow}`,
        maxWidth: 760,
        whiteSpace: "pre-line",
        textAlign: "left",
      }}
    >
      {el.text.replace(/\\n/g, "\n")}
      {snap.strikeProgress > 0 && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: -10,
            height: 6,
            width: `${snap.strikeProgress * 110}%`,
            background: COLORS.negative,
            transform: "translateY(-50%)",
            borderRadius: 3,
            boxShadow: "0 2px 6px rgba(220,38,38,0.45)",
          }}
        />
      )}
    </div>
  );
};
