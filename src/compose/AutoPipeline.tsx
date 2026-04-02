/**
 * AutoPipeline - Remotion 合成组件
 *
 * 只输出 overlay layer（信息图形 + 字幕）。
 * 医生真人画面和其他素材层由剪辑师在后期手工拼接。
 */

import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import type { Blueprint, TimingMap } from "../schemas/blueprint";
import { FullVideo } from "../remotion/FullVideo";
import { buildRenderSegmentSequencePlans } from "./pipeline-plan";
import { segmentsToRenderScenes } from "./segment-to-scene";
import { buildVisualPlan } from "./visual-planner";

export interface AutoPipelineProps {
  /** LLM 生成的三级 blueprint */
  blueprint: Blueprint;
  /** 输出时间映射 */
  timingMap: TimingMap;
  /** Layer visibility toggles for split rendering */
  showContent?: boolean;
  showNavigation?: boolean;
  showProgressBar?: boolean;
}

export const AutoPipeline: React.FC<AutoPipelineProps> = ({
  blueprint,
  timingMap,
  showContent = true,
  showNavigation = true,
  showProgressBar = true,
}) => {
  const { fps, durationInFrames: totalFrames } = useVideoConfig();
  const renderInfos = segmentsToRenderScenes(blueprint, timingMap);
  const renderSegmentPlans = buildRenderSegmentSequencePlans(
    renderInfos,
    timingMap,
    fps,
    totalFrames
  );
  const visualPlan = buildVisualPlan(blueprint, renderSegmentPlans);

  return (
    <AbsoluteFill>
      <FullVideo
        visualPlan={visualPlan}
        showContent={showContent}
        showNavigation={showNavigation}
        showProgressBar={showProgressBar}
      />
    </AbsoluteFill>
  );
};
