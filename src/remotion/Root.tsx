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
import { SVU05Motion } from "./demos/SVU05Motion";
import { PlatformSafeDemo } from "./demos/PlatformSafeDemo";
import { SVU05PlanDemo } from "./demos/SVU05PlanDemo";
import { SVU07PlanDemo } from "./demos/SVU07PlanDemo";
import { SVU08PlanDemo } from "./demos/SVU08PlanDemo";
import { SVU03PlanDemo } from "./demos/SVU03PlanDemo";
import { SVU01PlanDemo } from "./demos/SVU01PlanDemo";
import { SVU14PlanDemo } from "./demos/SVU14PlanDemo";
import { SVU02PlanDemo } from "./demos/SVU02PlanDemo";
import { SVU17PlanDemo } from "./demos/SVU17PlanDemo";
import { SVU04PlanDemo } from "./demos/SVU04PlanDemo";
import { SVU06PlanDemo } from "./demos/SVU06PlanDemo";
import { SVU09PlanDemo } from "./demos/SVU09PlanDemo";
import { SVU10PlanDemo } from "./demos/SVU10PlanDemo";
import { SVU11PlanDemo } from "./demos/SVU11PlanDemo";
import { SVU12PlanDemo } from "./demos/SVU12PlanDemo";
import { SVU13PlanDemo } from "./demos/SVU13PlanDemo";
import { SVU15PlanDemo } from "./demos/SVU15PlanDemo";
import { SVU16PlanDemo } from "./demos/SVU16PlanDemo";
import { SVU18PlanDemo } from "./demos/SVU18PlanDemo";
import { SVU19PlanDemo } from "./demos/SVU19PlanDemo";
import { SVU20PlanDemo } from "./demos/SVU20PlanDemo";
import { GenericVUClip } from "./demos/GenericVUClip";
import { TimelineVUClip } from "./demos/TimelineVUClip";
import svu05Dsl from "./demos/fixtures/svu05-dsl.json";
import type { DSLDoc } from "../vu/dsl/schema";

const SegmentPreviewComp: React.FC<{ scene: RenderScene }> = ({ scene }) => (
  <AbsoluteFill>
    <SceneRenderer scene={scene} />
  </AbsoluteFill>
);

const defaultPreviewScene: RenderScene = {
  id: "preview",
  topic_id: "T0",
  view: "graphics",
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

      <Composition
        id="SVU05Motion"
        component={SVU05Motion}
        durationInFrames={558}
        fps={30}
        width={1080}
        height={1920}
      />

      <Composition
        id="PlatformSafeDemo"
        component={PlatformSafeDemo}
        durationInFrames={330}
        fps={30}
        width={1080}
        height={1920}
      />

      <Composition
        id="SVU05PlanDemo"
        component={SVU05PlanDemo}
        durationInFrames={558}
        fps={30}
        width={1080}
        height={1920}
      />

      <Composition
        id="SVU07PlanDemo"
        component={SVU07PlanDemo}
        durationInFrames={401}
        fps={30}
        width={1080}
        height={1920}
      />

      <Composition
        id="SVU08PlanDemo"
        component={SVU08PlanDemo}
        durationInFrames={343}
        fps={30}
        width={1080}
        height={1920}
      />

      <Composition
        id="SVU03PlanDemo"
        component={SVU03PlanDemo}
        durationInFrames={185}
        fps={30}
        width={1080}
        height={1920}
      />

      <Composition
        id="SVU01PlanDemo"
        component={SVU01PlanDemo}
        durationInFrames={213}
        fps={30}
        width={1080}
        height={1920}
      />

      <Composition
        id="SVU14PlanDemo"
        component={SVU14PlanDemo}
        durationInFrames={1063}
        fps={30}
        width={1080}
        height={1920}
      />

      <Composition
        id="SVU02PlanDemo"
        component={SVU02PlanDemo}
        durationInFrames={139}
        fps={30}
        width={1080}
        height={1920}
      />

      <Composition
        id="SVU17PlanDemo"
        component={SVU17PlanDemo}
        durationInFrames={350}
        fps={30}
        width={1080}
        height={1920}
      />

      <Composition
        id="SVU04PlanDemo"
        component={SVU04PlanDemo}
        durationInFrames={175}
        fps={30}
        width={1080}
        height={1920}
      />

      <Composition
        id="SVU06PlanDemo"
        component={SVU06PlanDemo}
        durationInFrames={331}
        fps={30}
        width={1080}
        height={1920}
      />

      <Composition
        id="SVU09PlanDemo"
        component={SVU09PlanDemo}
        durationInFrames={746}
        fps={30}
        width={1080}
        height={1920}
      />

      <Composition
        id="SVU10PlanDemo"
        component={SVU10PlanDemo}
        durationInFrames={180}
        fps={30}
        width={1080}
        height={1920}
      />

      <Composition
        id="SVU11PlanDemo"
        component={SVU11PlanDemo}
        durationInFrames={338}
        fps={30}
        width={1080}
        height={1920}
      />

      <Composition
        id="SVU12PlanDemo"
        component={SVU12PlanDemo}
        durationInFrames={228}
        fps={30}
        width={1080}
        height={1920}
      />

      <Composition
        id="SVU13PlanDemo"
        component={SVU13PlanDemo}
        durationInFrames={185}
        fps={30}
        width={1080}
        height={1920}
      />

      <Composition
        id="SVU15PlanDemo"
        component={SVU15PlanDemo}
        durationInFrames={106}
        fps={30}
        width={1080}
        height={1920}
      />

      <Composition
        id="SVU16PlanDemo"
        component={SVU16PlanDemo}
        durationInFrames={490}
        fps={30}
        width={1080}
        height={1920}
      />

      <Composition
        id="SVU18PlanDemo"
        component={SVU18PlanDemo}
        durationInFrames={341}
        fps={30}
        width={1080}
        height={1920}
      />

      <Composition
        id="SVU19PlanDemo"
        component={SVU19PlanDemo}
        durationInFrames={514}
        fps={30}
        width={1080}
        height={1920}
      />

      <Composition
        id="SVU20PlanDemo"
        component={SVU20PlanDemo}
        durationInFrames={377}
        fps={30}
        width={1080}
        height={1920}
      />

      <Composition
        id="GenericVUClip"
        component={GenericVUClip as unknown as React.FC<Record<string, unknown>>}
        durationInFrames={300}
        fps={30}
        width={1080}
        height={1920}
      />

      <Composition
        id="TimelineVUClip"
        component={TimelineVUClip as unknown as React.FC<Record<string, unknown>>}
        durationInFrames={Math.max(60, Math.round((svu05Dsl as DSLDoc).duration_s * 30))}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          dsl: svu05Dsl as DSLDoc,
          durationFrames: Math.max(60, Math.round((svu05Dsl as DSLDoc).duration_s * 30)),
        } as unknown as Record<string, unknown>}
      />
    </>
  );
};
