/**
 * Remotion Root - 注册所有 Composition
 */

import React from "react";
import { AbsoluteFill, Composition, getInputProps } from "remotion";
import { AutoPipeline } from "../compose/AutoPipeline";
import type { AutoPipelineProps } from "../compose/AutoPipeline";
import { SceneRenderer } from "./compositions/SceneRenderer";
import type { RenderScene } from "../schemas/blueprint";
import { VIDEO_WIDTH, VIDEO_HEIGHT, VIDEO_FPS } from "./utils";

const SegmentPreviewComp: React.FC<{ scene: RenderScene }> = ({ scene }) => (
  <AbsoluteFill>
    <SceneRenderer scene={scene} />
  </AbsoluteFill>
);

const defaultPreviewScene: RenderScene = {
  id: "preview",
  topic_id: "T0",
  variant_id: "hero_text",
  title: "Preview",
  timeline: {
    enter_ms: 0,
    first_anchor_ms: 600,
    dwell_end_ms: 2600,
    exit_end_ms: 2900,
  },
  items: [{ text: "预览", emoji: "👁️" }],
  template_props: {},
};

export const RemotionRoot: React.FC = () => {
  const inputProps = getInputProps() as Partial<AutoPipelineProps> & {
    durationInFrames?: number;
    scene?: RenderScene;
  };

  const durationInFrames = inputProps.durationInFrames ?? 30 * VIDEO_FPS;

  const defaultProps: AutoPipelineProps = {
    audioSrc: inputProps.audioSrc ?? "",
    sourceVideoSrc: inputProps.sourceVideoSrc ?? "",
    blueprint: inputProps.blueprint ?? { title: "", scenes: [] },
    timingMap: inputProps.timingMap ?? {
      mode: "cut_video",
      segments: [],
      clips: [],
      totalDuration: 0,
    },
  };

  return (
    <>
      <Composition
        id="AutoPipeline"
        component={AutoPipeline as unknown as React.FC<Record<string, unknown>>}
        durationInFrames={durationInFrames}
        fps={VIDEO_FPS}
        width={VIDEO_WIDTH}
        height={VIDEO_HEIGHT}
        defaultProps={defaultProps as unknown as Record<string, unknown>}
      />

      <Composition
        id="SegmentPreview"
        component={SegmentPreviewComp as unknown as React.FC<Record<string, unknown>>}
        durationInFrames={150}
        fps={VIDEO_FPS}
        width={VIDEO_WIDTH}
        height={VIDEO_HEIGHT}
        defaultProps={{
          scene: inputProps.scene ?? defaultPreviewScene,
        } as unknown as Record<string, unknown>}
      />
    </>
  );
};
