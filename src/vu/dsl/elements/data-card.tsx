import React from "react";

import type { DataCardElement } from "../schema";
import { COLORS, FONTS } from "./tokens";

export const DataCardView: React.FC<{ el: DataCardElement }> = ({ el }) => (
  <div
    style={{
      width: 480,
      padding: "14px 22px",
      background: COLORS.paperGlass,
      borderRadius: 10,
      borderLeft: `4px solid ${COLORS.brand}`,
      fontFamily: FONTS.sans,
      boxShadow: "0 2px 6px rgba(0,0,0,0.06)",
    }}
  >
    <div
      style={{
        fontSize: 18,
        fontWeight: 700,
        color: COLORS.inkFaint,
        letterSpacing: 2,
        marginBottom: 4,
      }}
    >
      {el.title}
    </div>
    <div style={{ fontSize: 24, color: COLORS.ink, fontWeight: 700 }}>{el.primary}</div>
    {el.meta ? (
      <div style={{ fontSize: 18, color: COLORS.inkSoft, marginTop: 2 }}>{el.meta}</div>
    ) : null}
  </div>
);
