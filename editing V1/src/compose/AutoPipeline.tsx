/**
 * AutoPipeline - Remotion 合成组件
 *
 * 输出实体视频（信息图形 + 字幕 + 音频）。
 * 医生真人画面由剪辑师在剪映中作为 overlay 叠加。
 *
 * 遍历三级结构：scenes -> logic_segments -> atoms
 * 每个 LogicSegment 渲染为一个 Sequence，使用 SceneRenderer 路由到 15 个模板。
 * 音频支持两种模式：
 * - cut_video: 直接通播 cut_video.mp4
 * - source_direct: 按 timingMap.clips 直接读取原视频对应片段
 */

import React from "react";
import {
  AbsoluteFill,
  useVideoConfig,
  staticFile,
} from "remotion";
import type { Blueprint, TimingMap } from "../schemas/blueprint";
import { PipelineAudioTrack } from "./AudioTrack";
import { SegmentSequence } from "./SegmentSequence";
import {
  buildRenderSegmentSequencePlans,
  buildSourceDirectAudioSequencePlans,
} from "./pipeline-plan";
import { segmentsToRenderScenes } from "./segment-to-scene";

export interface AutoPipelineProps {
  /** 切割后的视频（cut_video 模式音频源） */
  audioSrc?: string;
  /** 原始视频（source_direct 模式媒体源） */
  sourceVideoSrc?: string;
  /** LLM 生成的三级 blueprint */
  blueprint: Blueprint;
  /** 输出时间映射 */
  timingMap: TimingMap;
}

export const AutoPipeline: React.FC<AutoPipelineProps> = ({
  audioSrc,
  sourceVideoSrc,
  blueprint,
  timingMap,
}) => {
  const { fps, durationInFrames: totalFrames } = useVideoConfig();

  const audioUrl = audioSrc ? staticFile(audioSrc) : "";
  const sourceVideoUrl = sourceVideoSrc ? staticFile(sourceVideoSrc) : "";
  const renderInfos = segmentsToRenderScenes(blueprint, timingMap);
  const sourceDirectAudioPlans = buildSourceDirectAudioSequencePlans(
    timingMap,
    fps
  );
  const renderSegmentPlans = buildRenderSegmentSequencePlans(
    renderInfos,
    timingMap,
    fps,
    totalFrames
  );

  return (
    <AbsoluteFill>
      <PipelineAudioTrack
        mode={timingMap.mode}
        audioUrl={audioUrl}
        sourceVideoUrl={sourceVideoUrl}
        sourceDirectPlans={sourceDirectAudioPlans}
      />

      {renderSegmentPlans.map((plan) => (
        <SegmentSequence key={plan.key} plan={plan} />
      ))}
    </AbsoluteFill>
  );
};


