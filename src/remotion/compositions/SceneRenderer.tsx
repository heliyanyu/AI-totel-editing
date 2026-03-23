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

const SubtitleOnly: React.FC<SceneProps> = () => null;

const VARIANT_MAP: Record<string, React.FC<SceneProps>> = {
  subtitle_only: SubtitleOnly,
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

/** Strip leading emoji from item.text if it duplicates the emoji field. */
function deduplicateItemEmoji(scene: SceneProps["scene"]): SceneProps["scene"] {
  if (!scene.items?.length) return scene;
  const cleaned = scene.items.map((item) => {
    if (!item.emoji || !item.text) return item;
    const trimmed = item.text.replace(/^\s*/, "");
    if (trimmed.startsWith(item.emoji)) {
      return { ...item, text: trimmed.slice(item.emoji.length).replace(/^\s*/, "") };
    }
    return item;
  });
  return { ...scene, items: cleaned };
}

export const SceneRenderer: React.FC<SceneProps> = ({ scene }) => {
  const Template = VARIANT_MAP[scene.variant_id] ?? HeroText;
  const isSubtitleOnly = scene.variant_id === "subtitle_only";
  const cleanedScene = deduplicateItemEmoji(scene);

  return (
    <AbsoluteFill
      style={isSubtitleOnly ? undefined : { background: BACKGROUND.canvas }}
    >
      <Template scene={cleanedScene} />
    </AbsoluteFill>
  );
};
