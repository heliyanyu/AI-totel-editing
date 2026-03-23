/**
 * useSceneAnimation — 所有模板共享的核心 hook
 *
 * 封装帧计算、入场/退出/驻留样式，消除 15 个模板的重复代码。
 */

import { useCurrentFrame, useVideoConfig } from "remotion";
import type { CSSProperties } from "react";
import type { Scene } from "../types";
import { msToFrame } from "../utils";
import {
  slideUpIn, slideDownOut, dwellFloat,
  stagger, staggerReverse, mergeStyles,
} from "../animations/index";

export interface SceneAnimationResult {
  /** 当前帧 */
  frame: number;
  /** 帧率 */
  fps: number;
  /** 入场起始帧（相对于场景） */
  enterStartFrame: number;
  /** 驻留结束帧 */
  dwellEndFrame: number;
  /** 退出结束帧 */
  exitEndFrame: number;
  /** 场景内 items 数 */
  totalItems: number;
  /** 获取某个 item 的合并动画样式 */
  getItemStyle: (index: number) => CSSProperties;
  /** 场景进度 0-1 */
  sceneProgress: number;
}

/**
 * @param scene Scene 对象
 * @param staggerDelay 入场 stagger 帧间隔（默认 3）
 * @param exitStaggerDelay 退出 stagger 帧间隔（默认 2）
 */
export function useSceneAnimation(
  scene: Scene,
  staggerDelay: number = 3,
  exitStaggerDelay: number = 2,
): SceneAnimationResult {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enterMs = scene.timeline.enter_ms;
  const enterStartFrame = msToFrame(scene.timeline.first_anchor_ms - enterMs, fps);
  const dwellEndFrame = msToFrame(scene.timeline.dwell_end_ms - enterMs, fps);
  const exitEndFrame = msToFrame(scene.timeline.exit_end_ms - enterMs, fps);
  const totalDuration = exitEndFrame;
  const totalItems = scene.items.length;

  const sceneProgress = totalDuration > 0 ? Math.min(1, frame / totalDuration) : 0;

  function getItemStyle(index: number): CSSProperties {
    // 入场：优先使用 anchor_offset_ms（锚点驱动），否则回退到固定 stagger
    const item = scene.items[index];
    const anchorOffsetMs = item?.anchor_offset_ms;
    const entryDelay = anchorOffsetMs !== undefined
      ? msToFrame(anchorOffsetMs, fps) // anchor-driven: appear when speaker mentions it
      : enterStartFrame + stagger(index, staggerDelay); // fallback: fixed stagger
    const entryFrame = anchorOffsetMs !== undefined ? entryDelay : entryDelay;

    const entry = slideUpIn(frame, entryFrame, fps);

    // 退出
    const exitDelay = staggerReverse(index, totalItems, exitStaggerDelay);
    const exit = slideDownOut(frame, dwellEndFrame + exitDelay, fps);

    // 驻留微浮动
    const isDwelling = frame > entryFrame + 15 && frame < dwellEndFrame;
    const dwell = isDwelling ? dwellFloat(frame, fps, index) : { opacity: 1 };

    // 合并
    const combined = mergeStyles(mergeStyles(entry, exit), dwell);

    return {
      opacity: combined.opacity,
      transform: combined.transform,
      filter: combined.filter,
    };
  }

  return {
    frame,
    fps,
    enterStartFrame,
    dwellEndFrame,
    exitEndFrame,
    totalItems,
    getItemStyle,
    sceneProgress,
  };
}
