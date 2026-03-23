import React, { useMemo } from "react";
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import type { TransitionPresentation } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { clockWipe } from "@remotion/transitions/clock-wipe";
import { blurScale } from "./transitions/blur-scale";
import { SegmentLayer } from "../compose/SegmentLayer";
import { NavigationMap } from "./overlays/NavigationMap";
import { TopProgressBar } from "./overlays/TopProgressBar";
import { VIDEO_HEIGHT, VIDEO_WIDTH } from "./utils";
import { BACKGROUND } from "./design-system";
import type { VisualPlan } from "../compose/visual-planner";

export interface FullVideoProps {
  visualPlan: VisualPlan;
}

const TRANSITION_FRAMES = 18;

function getTransitionPresentation(
  type?: string
): TransitionPresentation<Record<string, unknown>> {
  switch (type) {
    case "slide_left":
      return slide({ direction: "from-right" }) as TransitionPresentation<Record<string, unknown>>;
    case "slide_right":
      return slide({ direction: "from-left" }) as TransitionPresentation<Record<string, unknown>>;
    case "slide_up":
      return slide({ direction: "from-bottom" }) as TransitionPresentation<Record<string, unknown>>;
    case "wipe_right":
      return wipe({ direction: "from-left" }) as TransitionPresentation<Record<string, unknown>>;
    case "wipe_down":
      return wipe({ direction: "from-top-left" }) as TransitionPresentation<Record<string, unknown>>;
    case "clock_wipe":
      return clockWipe({
        width: VIDEO_WIDTH,
        height: VIDEO_HEIGHT,
      }) as unknown as TransitionPresentation<Record<string, unknown>>;
    case "blur_scale":
      return blurScale() as TransitionPresentation<Record<string, unknown>>;
    case "fade":
    default:
      return fade() as TransitionPresentation<Record<string, unknown>>;
  }
}

export const FullVideo: React.FC<FullVideoProps> = ({ visualPlan }) => {
  const { durationInFrames: totalFrames } = useVideoConfig();

  const segments = useMemo(
    () =>
      [...visualPlan.segments]
        .filter((segment) => segment.contentDurationInFrames > 0)
        .sort((left, right) => left.fromFrame - right.fromFrame),
    [visualPlan.segments]
  );

  const buildChildren = () => {
    const elements: React.ReactNode[] = [];
    if (segments.length === 0) {
      return elements;
    }

    let cursor = 0;

    if (segments[0].fromFrame > 0) {
      elements.push(
        <TransitionSeries.Sequence
          key="spacer-start"
          durationInFrames={segments[0].fromFrame}
          name="Spacer: start"
        >
          <AbsoluteFill style={{ background: BACKGROUND.canvas }} />
        </TransitionSeries.Sequence>
      );
      cursor = segments[0].fromFrame;
    }

    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index];
      const next = segments[index + 1];
      const segmentEnd = segment.fromFrame + segment.contentDurationInFrames;
      const gapToNext = next ? next.fromFrame - segmentEnd : totalFrames - segmentEnd;
      const needsTransition = Boolean(next && gapToNext <= 0);
      const durationInFrames =
        segment.contentDurationInFrames + (needsTransition ? TRANSITION_FRAMES : 0);

      elements.push(
        <TransitionSeries.Sequence
          key={segment.key}
          durationInFrames={durationInFrames}
          name={`Segment: ${segment.key}`}
        >
          <SegmentLayer plan={segment} />
        </TransitionSeries.Sequence>
      );
      cursor += durationInFrames;

      if (needsTransition && segment.transitionToNext) {
        elements.push(
          <TransitionSeries.Transition
            key={`transition-${segment.key}-${next!.key}`}
            timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
            presentation={getTransitionPresentation(segment.transitionToNext)}
          />
        );
        cursor -= TRANSITION_FRAMES;
      }

      if (next) {
        const spacer = next.fromFrame - cursor;
        if (spacer > 0) {
          elements.push(
            <TransitionSeries.Sequence
              key={`spacer-${segment.key}-${next.key}`}
              durationInFrames={spacer}
              name={`Spacer: ${segment.key} -> ${next.key}`}
            >
              <AbsoluteFill style={{ background: BACKGROUND.canvas }} />
            </TransitionSeries.Sequence>
          );
          cursor += spacer;
        }
      }
    }

    const tailGap = totalFrames - cursor;
    if (tailGap > 0) {
      elements.push(
        <TransitionSeries.Sequence
          key="spacer-tail"
          durationInFrames={tailGap}
          name="Spacer: tail"
        >
          <AbsoluteFill style={{ background: BACKGROUND.canvas }} />
        </TransitionSeries.Sequence>
      );
    }

    return elements;
  };

  return (
    <AbsoluteFill style={{ background: BACKGROUND.canvas }}>
      <TransitionSeries>{buildChildren()}</TransitionSeries>

      {visualPlan.topicAppearances.map((appearance, index) => (
        <Sequence
          key={`nav-${index}`}
          from={appearance.startFrame}
          durationInFrames={appearance.endFrame - appearance.startFrame}
          name={`Nav: ${appearance.activeNode}`}
        >
          <NavigationMap appearance={appearance} nodes={visualPlan.topicNodes} />
        </Sequence>
      ))}

      <TopProgressBar segments={segments} nodes={visualPlan.topicNodes} />
    </AbsoluteFill>
  );
};
