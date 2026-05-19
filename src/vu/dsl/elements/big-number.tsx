import React from "react";

import type { ElementSnapshot } from "../interpreter";
import type { BigNumberElement } from "../schema";
import { COLORS, FONTS, toneStyle } from "./tokens";

interface Props {
  el: BigNumberElement;
  snap: ElementSnapshot;
}

export const BigNumberView: React.FC<Props> = ({ el, snap }) => {
  const tone = toneStyle(el.tone);
  const value = snap.countValue != null ? Math.round(snap.countValue) : el.value;
  const prefixLen = (el.prefix ?? "").length;
  const suffixLen = (el.suffix ?? "").length;
  const valueLen = String(value).length;
  const totalLen = prefixLen + suffixLen + valueLen;
  const mainFont = totalLen <= 4 ? 240 : totalLen <= 6 ? 180 : totalLen <= 8 ? 130 : 96;
  const affixFont = Math.round(mainFont * 0.62);
  return (
    <div style={{ textAlign: "center", maxWidth: 700 }}>
      {el.annotation_above ? (
        <div
          style={{
            fontFamily: FONTS.sans,
            fontSize: 36,
            fontWeight: 600,
            color: COLORS.inkSoft,
            marginBottom: -6,
          }}
        >
          {el.annotation_above}
        </div>
      ) : null}

      <div
        style={{
          fontFamily: FONTS.num,
          fontSize: mainFont,
          fontWeight: 900,
          color: tone.fg,
          lineHeight: 1,
          letterSpacing: -4,
          textShadow: `0 6px 22px ${tone.glow}`,
          whiteSpace: "nowrap",
        }}
      >
        {el.prefix ? <span style={{ fontSize: affixFont }}>{el.prefix}</span> : null}
        <span>{value}</span>
        {el.suffix ? <span style={{ fontSize: affixFont }}>{el.suffix}</span> : null}
      </div>

      {el.annotation_below ? (
        <div
          style={{
            fontFamily: FONTS.sans,
            fontSize: 36,
            fontWeight: 700,
            color: COLORS.ink,
            marginTop: 4,
          }}
        >
          {el.annotation_below}
        </div>
      ) : null}
    </div>
  );
};
