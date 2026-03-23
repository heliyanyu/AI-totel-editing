import React from "react";
import { AbsoluteFill, OffthreadVideo, Sequence } from "remotion";
import type { SourceDirectAudioSequencePlan } from "./pipeline-plan";

export interface SourceDirectVideoTrackProps {
  mode: "cut_video" | "source_direct";
  sourceVideoUrl: string;
  sourceDirectPlans: SourceDirectAudioSequencePlan[];
}

export const SourceDirectVideoTrack: React.FC<SourceDirectVideoTrackProps> = ({
  mode,
  sourceVideoUrl,
  sourceDirectPlans,
}) => {
  if (mode !== "source_direct" || !sourceVideoUrl) {
    return null;
  }

  return (
    <>
      {sourceDirectPlans.map((plan) => (
        <Sequence
          key={`video-${plan.key}`}
          from={plan.fromFrame}
          durationInFrames={plan.durationInFrames}
        >
          <AbsoluteFill>
            <OffthreadVideo
              src={sourceVideoUrl}
              trimBefore={plan.trimBefore}
              trimAfter={plan.trimAfter}
              muted
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </AbsoluteFill>
        </Sequence>
      ))}
    </>
  );
};
