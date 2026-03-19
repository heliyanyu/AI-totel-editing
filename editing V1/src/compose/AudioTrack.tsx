import React from "react";
import { Audio, Sequence } from "remotion";
import type { SourceDirectAudioSequencePlan } from "./pipeline-plan";

export interface PipelineAudioTrackProps {
  mode: "cut_video" | "source_direct";
  audioUrl: string;
  sourceVideoUrl: string;
  sourceDirectPlans: SourceDirectAudioSequencePlan[];
}

export const PipelineAudioTrack: React.FC<PipelineAudioTrackProps> = ({
  mode,
  audioUrl,
  sourceVideoUrl,
  sourceDirectPlans,
}) => {
  if (mode === "source_direct") {
    if (audioUrl) {
      return <Audio src={audioUrl} />;
    }

    if (!sourceVideoUrl) {
      return null;
    }

    return (
      <>
        {sourceDirectPlans.map((plan) => (
          <Sequence
            key={plan.key}
            from={plan.fromFrame}
            durationInFrames={plan.durationInFrames}
          >
            <Audio
              src={sourceVideoUrl}
              trimBefore={plan.trimBefore}
              trimAfter={plan.trimAfter}
              volume={1}
            />
          </Sequence>
        ))}
      </>
    );
  }

  return audioUrl ? <Audio src={audioUrl} /> : null;
};
