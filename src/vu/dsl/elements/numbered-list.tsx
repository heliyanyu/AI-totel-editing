import React from "react";

import type { ElementSnapshot } from "../interpreter";
import type { NumberedListElement } from "../schema";
import { COLORS, FONTS } from "./tokens";

interface Props {
  el: NumberedListElement;
  snap: ElementSnapshot;
  frame: number;
}

const STAGGER_FRAMES = 8;
const ITEM_TWEEN_FRAMES = 18;

export const NumberedListView: React.FC<Props> = ({ el, snap, frame }) => {
  const appeared = snap.appearedFrame ?? frame;
  const prefix = el.prefix_word ?? "问题";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, width: 480 }}>
      {el.items.map((item, idx) => {
        const itemStart = appeared + idx * STAGGER_FRAMES;
        const local = frame - itemStart;
        if (local < 0) return <div key={idx} style={{ opacity: 0, height: 92 }} />;
        const t = Math.min(1, local / ITEM_TWEEN_FRAMES);
        const dx = (1 - t) * -60;
        const opacity = Math.min(1, local / 6);
        const isActive = snap.childHighlight[String(idx)] ?? false;
        return (
          <div
            key={idx}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "18px 22px",
              background: isActive ? "#FEF3C7" : COLORS.paper,
              borderRadius: 14,
              border: isActive ? `3px solid ${COLORS.warning}` : `2px solid ${COLORS.hairline}`,
              boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
              opacity,
              transform: `translateX(${dx}px)`,
              willChange: "transform, opacity",
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: "50%",
                background: isActive ? COLORS.warning : COLORS.inkFaint,
                color: "white",
                fontFamily: FONTS.num,
                fontSize: 32,
                fontWeight: 800,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {idx + 1}
            </div>
            <div
              style={{
                fontFamily: FONTS.sans,
                fontSize: 36,
                fontWeight: 700,
                color: isActive ? COLORS.ink : COLORS.inkSoft,
              }}
            >
              {prefix} {idx + 1}：{item.label}
            </div>
          </div>
        );
      })}
    </div>
  );
};
