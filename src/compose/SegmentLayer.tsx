import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { SceneRenderer } from "../remotion/compositions/SceneRenderer";
import type { VisualSegmentPlan } from "./visual-planner";

export interface SegmentLayerProps {
  plan: VisualSegmentPlan;
}

export const SegmentLayer: React.FC<SegmentLayerProps> = ({ plan }) => {
  return (
    <AbsoluteFill>
      <SceneRenderer scene={plan.renderScene} />
    </AbsoluteFill>
  );
};
