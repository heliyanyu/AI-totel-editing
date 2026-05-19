import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

import { renderElement, type ResolvedAsset } from "../../vu/dsl/elements";
import { getZoneTable } from "../../vu/dsl/families";
import { computeSnapshot } from "../../vu/dsl/interpreter";
import type { DSLDoc } from "../../vu/dsl/schema";

export interface TimelineVUClipProps {
  dsl: DSLDoc;
  durationFrames: number;
  resolvedAssets?: Record<string, ResolvedAsset>;
}

const STAGE_BG = "linear-gradient(160deg, #F6FAFF 0%, #ECF4FF 50%, #FBFEFF 100%)";

export const TimelineVUClip: React.FC<TimelineVUClipProps> = ({ dsl, resolvedAssets }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const zones = getZoneTable(dsl.family);

  return (
    <AbsoluteFill style={{ background: STAGE_BG }}>
      {dsl.elements.map((el) => {
        const snap = computeSnapshot(el.id, dsl, zones, fps, frame);
        if (!snap.visible) return null;
        return (
          <div
            key={el.id}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              transform: `translate(-50%, -50%) translate(${snap.x}px, ${snap.y}px) scale(${snap.scale}) rotate(${snap.rotate}deg)`,
              opacity: snap.opacity,
              willChange: "transform, opacity",
            }}
          >
            {renderElement(el, snap, { fps, frame, resolvedAssets })}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
