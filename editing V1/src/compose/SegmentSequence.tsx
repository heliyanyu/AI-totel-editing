import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { SceneRenderer } from "../remotion/compositions/SceneRenderer";
import { Subtitle } from "../remotion/overlays/Subtitle";
import type { RenderSegmentSequencePlan } from "./pipeline-plan";

export interface SegmentSequenceProps {
  plan: RenderSegmentSequencePlan;
}

export const SegmentSequence: React.FC<SegmentSequenceProps> = ({ plan }) => {
  return (
    <Sequence from={plan.fromFrame} durationInFrames={plan.durationInFrames}>
      <AbsoluteFill>
        <SceneRenderer scene={plan.renderScene} />

        {plan.subtitles.map((subtitle) => (
          <Sequence
            key={subtitle.key}
            from={subtitle.fromFrame}
            durationInFrames={subtitle.durationInFrames}
          >
            <Subtitle
              words={subtitle.words}
              atomOriginalStart={subtitle.atomOriginalStart}
              fallbackText={subtitle.fallbackText}
            />
          </Sequence>
        ))}
      </AbsoluteFill>
    </Sequence>
  );
};
