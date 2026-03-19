/**
 * SceneRenderer — 根据 variant_id 路由到 15 个模板组件
 */

import React from "react";
import { AbsoluteFill } from "remotion";
import type { SceneProps } from "../types";
import { BACKGROUND, SAFE_AREA } from "../design-system";

// 15 个模板组件
import { HeroText } from "./templates/HeroText";
import { NumberCenter } from "./templates/NumberCenter";
import { WarningAlert } from "./templates/WarningAlert";
import { TermCard } from "./templates/TermCard";
import { ImageOverlay } from "./templates/ImageOverlay";
import { ListFade } from "./templates/ListFade";
import { ColorGrid } from "./templates/ColorGrid";
import { BodyAnnotate } from "./templates/BodyAnnotate";
import { StepArrow } from "./templates/StepArrow";
import { BranchPath } from "./templates/BranchPath";
import { BrickStack } from "./templates/BrickStack";
import { SplitColumn } from "./templates/SplitColumn";
import { MythBuster } from "./templates/MythBuster";
import { CategoryTable } from "./templates/CategoryTable";
import { VerticalTimeline } from "./templates/VerticalTimeline";

const VARIANT_MAP: Record<string, React.FC<SceneProps>> = {
  hero_text: HeroText,
  number_center: NumberCenter,
  warning_alert: WarningAlert,
  term_card: TermCard,
  image_overlay: ImageOverlay,
  list_fade: ListFade,
  color_grid: ColorGrid,
  body_annotate: BodyAnnotate,
  step_arrow: StepArrow,
  branch_path: BranchPath,
  brick_stack: BrickStack,
  split_column: SplitColumn,
  myth_buster: MythBuster,
  category_table: CategoryTable,
  vertical_timeline: VerticalTimeline,
};

export const SceneRenderer: React.FC<SceneProps> = ({ scene }) => {
  const Template = VARIANT_MAP[scene.variant_id] ?? HeroText;

  return (
    <AbsoluteFill style={{ background: BACKGROUND.canvas }}>
      <Template scene={scene} />
    </AbsoluteFill>
  );
};
