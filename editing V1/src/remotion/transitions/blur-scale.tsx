/**
 * blur-scale 自定义转场
 *
 * 进入场景：scale 1.1→1.0 + blur 8→0 (zoom-in 感)
 * 退出场景：scale 1.0→0.95 + blur 0→6 + opacity 1→0 (后退模糊感)
 *
 * 适合数据密集型场景之间的切换，营造"聚焦"的视觉隐喻。
 */

import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import type { TransitionPresentation } from "@remotion/transitions";

const BlurScaleComponent: React.FC<
  Record<string, unknown> & {
    children: React.ReactNode;
    presentationDirection: "entering" | "exiting";
    presentationProgress: number;
  }
> = ({ children, presentationDirection, presentationProgress }) => {
  const isEntering = presentationDirection === "entering";

  const scale = isEntering
    ? interpolate(presentationProgress, [0, 1], [1.1, 1.0])
    : interpolate(presentationProgress, [0, 1], [1.0, 0.95]);

  const blur = isEntering
    ? interpolate(presentationProgress, [0, 1], [8, 0])
    : interpolate(presentationProgress, [0, 1], [0, 6]);

  const opacity = isEntering
    ? interpolate(presentationProgress, [0, 0.4], [0, 1], {
        extrapolateRight: "clamp",
      })
    : interpolate(presentationProgress, [0.6, 1], [1, 0], {
        extrapolateLeft: "clamp",
      });

  return (
    <AbsoluteFill
      style={{
        opacity,
        transform: `scale(${scale})`,
        filter: blur > 0.1 ? `blur(${blur}px)` : undefined,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

export function blurScale(): TransitionPresentation<Record<string, unknown>> {
  return {
    component: BlurScaleComponent as any,
    props: {},
  };
}
