import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { SceneRenderer } from "../remotion/compositions/SceneRenderer";
import type { RenderSegmentSequencePlan } from "./pipeline-plan";

export interface SegmentSequenceProps {
  plan: RenderSegmentSequencePlan;
}

export const SegmentSequence: React.FC<SegmentSequenceProps> = ({ plan }) => {
  return (
    <Sequence from={plan.fromFrame} durationInFrames={plan.durationInFrames}>
      <AbsoluteFill>
        <SceneRenderer scene={plan.renderScene} />
      </AbsoluteFill>
    </Sequence>
  );
};
