import React from "react";
import { OffthreadVideo } from "remotion";

import type { VideoPanelElement } from "../schema";
import { COLORS, FONTS } from "./tokens";

export interface ResolvedAsset {
  type: "image" | "video";
  src: string;
}

interface Props {
  el: VideoPanelElement;
  resolvedAssets?: Record<string, ResolvedAsset>;
}

export const VideoPanelView: React.FC<Props> = ({ el, resolvedAssets }) => {
  const asset = resolvedAssets?.[el.asset_slot];
  return (
    <div
      style={{
        width: 440,
        height: 580,
        borderRadius: 14,
        overflow: "hidden",
        border: `3px solid ${COLORS.warning}`,
        boxShadow: "0 8px 24px rgba(0,0,0,0.20)",
        position: "relative",
        background: "#0F172A",
      }}
    >
      {asset?.type === "video" ? (
        <OffthreadVideo
          src={asset.src}
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : asset?.type === "image" ? (
        <img
          src={asset.src}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          alt=""
        />
      ) : el.fallback_emoji ? (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "linear-gradient(160deg, #F1F5F9 0%, #E2E8F0 100%)",
            fontSize: 240,
            lineHeight: 1,
          }}
        >
          {el.fallback_emoji}
        </div>
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "linear-gradient(160deg, #F1F5F9 0%, #E2E8F0 100%)",
            color: COLORS.inkFaint,
            fontFamily: FONTS.sans,
            fontSize: 28,
            textAlign: "center",
            padding: 20,
          }}
        >
          {el.asset_slot}
        </div>
      )}
      {el.label ? (
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            padding: "5px 12px",
            background: COLORS.warning,
            color: "white",
            fontFamily: FONTS.sans,
            fontSize: 20,
            fontWeight: 700,
            borderRadius: 5,
            letterSpacing: 1,
          }}
        >
          {el.label}
        </div>
      ) : null}
    </div>
  );
};
