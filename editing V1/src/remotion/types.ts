/**
 * Remotion 专用类型定义
 * 从 blueprint schema 重导出 + Remotion 渲染层独有类型
 */

import type {
  Blueprint,
  Scene,
  SceneTimeline,
  Item,
  VariantId,
  TemplateProps,
  TransitionType,
  NavAppearance,
  NavNode,
  NavStructure,
} from "../schemas/blueprint";

export type {
  Blueprint,
  Scene,
  SceneTimeline,
  Item,
  VariantId,
  TemplateProps,
  TransitionType,
  NavAppearance,
  NavNode,
  NavStructure,
};

export type { OverlayTheme } from "./theme/ThemeProvider";

/** FullVideo 组件的 props */
export interface FullVideoProps {
  blueprint: Blueprint;
}

/** 场景模板组件的通用 props */
export interface SceneProps {
  scene: Scene;
}

/** 动画样式结果 */
export interface AnimationStyle {
  opacity: number;
  transform?: string;
  filter?: string;
  clipPath?: string;
}
