import type { Blueprint, TransitionType } from "../schemas/blueprint";
import type { SceneTone } from "../remotion/visual-language";
import type { RenderSegmentSequencePlan } from "./pipeline-plan";

export interface VisualTopicNode {
  id: string;
  label: string;
  sceneIds: string[];
}

export interface VisualNavAppearance {
  type: "flash" | "stay";
  mode: "focus" | "compact";
  startFrame: number;
  endFrame: number;
  activeNode: string;
  completedNodes: string[];
  label: string;
  tone: SceneTone;
}

export type VisualSceneRole =
  | "opener"
  | "topic_entry"
  | "analysis"
  | "comparison"
  | "warning"
  | "summary"
  | "bridge";

export type VisualLayoutMode =
  | "overlay_left"
  | "overlay_right"
  | "overlay_center"
  | "stack"
  | "board"
  | "spotlight"
  | "split_board";

export interface VisualSegmentPlan extends RenderSegmentSequencePlan {
  topicId: string;
  topicLabel: string;
  topicIndex: number;
  topicCount: number;
  topicSegmentIndex: number;
  isTopicEntry: boolean;
  voiceoverOnly: boolean;
  role: VisualSceneRole;
  tone: SceneTone;
  layoutMode: VisualLayoutMode;
  transitionToNext?: TransitionType;
}

export interface VisualPlan {
  segments: VisualSegmentPlan[];
  topicNodes: VisualTopicNode[];
  topicAppearances: VisualNavAppearance[];
}

const CROSS_TOPIC_TRANSITIONS: TransitionType[] = [
  "blur_scale",
  "clock_wipe",
  "wipe_right",
];

const SAME_TOPIC_TRANSITIONS: TransitionType[] = [
  "fade",
  "slide_left",
  "slide_up",
];

const VARIANT_ENTRY_TRANSITION: Partial<Record<string, TransitionType>> = {
  warning_alert: "wipe_right",
  hero_text: "blur_scale",
  brick_stack: "slide_up",
  split_column: "slide_left",
};

const BRIDGE_CUES = [
  "先说",
  "先看",
  "最后",
  "总结",
  "接下来",
  "再看",
  "再说",
  "几个",
  "三点",
  "四个",
  "五个",
];

const SUMMARY_CUES = ["最后", "总结", "记住", "核心", "重点", "结论", "放心"];
const POSITIVE_CUES = ["放心", "可以", "改善", "稳定", "回升", "建议", "做到"];
const WARNING_CUES = ["危险", "不要", "警惕", "风险", "恶化", "坏处", "后果", "拖"];

const NAV_MIN_DURATION_FRAMES = 48;
const NAV_COMPACT_DURATION_FRAMES = 72;
const NAV_FOCUS_DURATION_FRAMES = 96;

function normalizeText(text: string | undefined): string {
  return (text ?? "")
    .replace(/\s+/g, "")
    .replace(/[，。！？、,.!?:：；]/g, "");
}

function buildTopicNodes(blueprint: Blueprint): VisualTopicNode[] {
  return blueprint.scenes.map((scene) => ({
    id: scene.id,
    label: scene.title?.trim() || scene.id,
    sceneIds: scene.logic_segments.map((segment) => segment.id),
  }));
}

function isVoiceoverOnly(plan: RenderSegmentSequencePlan): boolean {
  const explicit = plan.renderScene.template_props?.voiceover_only;
  if (explicit === true) {
    return true;
  }

  if (plan.renderScene.variant_id === "subtitle_only") {
    return true;
  }

  if (plan.renderScene.variant_id !== "hero_text") {
    return false;
  }

  if (plan.renderScene.items.length > 1) {
    return false;
  }

  const combined = normalizeText(
    `${plan.renderScene.title ?? ""}${plan.renderScene.items.map((item) => item.text).join("")}`
  );

  if (combined.length === 0 || combined.length > 20) {
    return false;
  }

  return BRIDGE_CUES.some((cue) => combined.includes(cue));
}

function deriveRole(
  plan: RenderSegmentSequencePlan,
  isTopicEntry: boolean,
  topicIndex: number,
  topicSegmentIndex: number,
  topicCount: number,
  voiceoverOnly: boolean
): VisualSceneRole {
  if (voiceoverOnly) {
    return "bridge";
  }

  const variant = plan.renderScene.variant_id;
  const combined = normalizeText(
    `${plan.renderScene.title ?? ""}${plan.renderScene.items.map((item) => item.text).join("")}`
  );

  if (variant === "warning_alert") {
    return "warning";
  }

  if (["split_column", "myth_buster", "category_table"].includes(variant)) {
    return "comparison";
  }

  if (
    topicIndex === 0 &&
    topicSegmentIndex === 0 &&
    ["hero_text", "number_center", "term_card"].includes(variant)
  ) {
    return "opener";
  }

  if (
    topicIndex === topicCount - 1 &&
    (SUMMARY_CUES.some((cue) => combined.includes(cue)) ||
      ["hero_text", "list_fade", "number_center"].includes(variant))
  ) {
    return "summary";
  }

  if (isTopicEntry) {
    return "topic_entry";
  }

  return "analysis";
}

function deriveTone(plan: RenderSegmentSequencePlan, role: VisualSceneRole): SceneTone {
  const variant = plan.renderScene.variant_id;
  const combined = normalizeText(
    `${plan.renderScene.title ?? ""}${plan.renderScene.items.map((item) => item.text).join("")}`
  );

  if (role === "warning" || WARNING_CUES.some((cue) => combined.includes(cue))) {
    return "warning";
  }

  if (role === "summary" && POSITIVE_CUES.some((cue) => combined.includes(cue))) {
    return "positive";
  }

  if (["split_column", "myth_buster", "category_table"].includes(variant)) {
    return "info";
  }

  if (["brick_stack", "step_arrow", "list_fade", "hero_text"].includes(variant)) {
    return "brand";
  }

  if (["number_center", "term_card"].includes(variant)) {
    return "positive";
  }

  return "neutral";
}

function deriveLayoutMode(
  plan: RenderSegmentSequencePlan,
  role: VisualSceneRole,
  voiceoverOnly: boolean
): VisualLayoutMode {
  const view = plan.renderScene.view ?? "graphics";
  const variant = plan.renderScene.variant_id;

  if (voiceoverOnly) {
    return "overlay_center";
  }

  if (variant === "split_column") {
    return "split_board";
  }

  if (variant === "step_arrow" || variant === "list_fade") {
    return view === "overlay" ? "stack" : "board";
  }

  if (variant === "warning_alert") {
    return view === "overlay" ? "overlay_right" : "spotlight";
  }

  if (variant === "hero_text") {
    return view === "overlay"
      ? role === "summary"
        ? "overlay_center"
        : "overlay_left"
      : "spotlight";
  }

  if (view === "overlay") {
    return role === "comparison" ? "overlay_right" : "overlay_left";
  }

  return "board";
}

function autoTransitionType(
  current: VisualSegmentPlan,
  next: VisualSegmentPlan,
  index: number
): TransitionType {
  if (next.role === "warning") {
    return "wipe_right";
  }

  if (next.role === "summary") {
    return "blur_scale";
  }

  if (next.role === "comparison") {
    return "slide_left";
  }

  const nextVariant = next.renderScene.variant_id;
  if (current.topicId !== next.topicId) {
    if (nextVariant && VARIANT_ENTRY_TRANSITION[nextVariant]) {
      return VARIANT_ENTRY_TRANSITION[nextVariant]!;
    }
    return CROSS_TOPIC_TRANSITIONS[index % CROSS_TOPIC_TRANSITIONS.length];
  }

  if (current.layoutMode !== next.layoutMode) {
    return "slide_up";
  }

  return SAME_TOPIC_TRANSITIONS[index % SAME_TOPIC_TRANSITIONS.length];
}

function buildNavAppearances(
  segments: VisualSegmentPlan[],
  topicNodes: VisualTopicNode[]
): VisualNavAppearance[] {
  if (topicNodes.length === 0) {
    return [];
  }

  const byTopic = new Map<string, VisualSegmentPlan[]>();
  for (const segment of segments) {
    const list = byTopic.get(segment.topicId) ?? [];
    list.push(segment);
    byTopic.set(segment.topicId, list);
  }

  const appearances: VisualNavAppearance[] = [];

  for (let index = 0; index < topicNodes.length; index++) {
    const currentTopic = topicNodes[index];
    const topicSegments = byTopic.get(currentTopic.id) ?? [];
    if (topicSegments.length === 0) {
      continue;
    }

    const firstSegment = topicSegments[0];
    const entryEnd = firstSegment.fromFrame + firstSegment.contentDurationInFrames;
    const mode =
      index === 0 ||
      firstSegment.voiceoverOnly ||
      ["opener", "summary", "bridge"].includes(firstSegment.role)
        ? "focus"
        : "compact";
    const requestedDuration =
      mode === "focus" ? NAV_FOCUS_DURATION_FRAMES : NAV_COMPACT_DURATION_FRAMES;
    const duration = Math.max(
      NAV_MIN_DURATION_FRAMES,
      Math.min(requestedDuration, firstSegment.contentDurationInFrames)
    );
    const startFrame = Math.max(
      0,
      firstSegment.fromFrame + (mode === "focus" ? 4 : 8)
    );
    const endFrame = Math.min(entryEnd, startFrame + duration);

    if (endFrame - startFrame <= 0) {
      continue;
    }

    appearances.push({
      type: index === 0 || index === topicNodes.length - 1 ? "stay" : "flash",
      mode,
      startFrame,
      endFrame,
      activeNode: currentTopic.id,
      completedNodes: topicNodes.slice(0, index).map((node) => node.id),
      label: currentTopic.label,
      tone: firstSegment.tone,
    });
  }

  return appearances;
}

export function buildVisualPlan(
  blueprint: Blueprint,
  renderSegmentPlans: RenderSegmentSequencePlan[]
): VisualPlan {
  const topicNodes = buildTopicNodes(blueprint);
  const topicIndexById = new Map(topicNodes.map((node, index) => [node.id, index] as const));
  const topicLabelById = new Map(topicNodes.map((node) => [node.id, node.label] as const));
  const seenTopicEntries = new Set<string>();
  const topicSegmentCount = new Map<string, number>();
  for (const plan of renderSegmentPlans) {
    const topicId = plan.renderScene.topic_id;
    topicSegmentCount.set(topicId, (topicSegmentCount.get(topicId) ?? 0) + 1);
  }
  const topicSeenCount = new Map<string, number>();

  const segments: VisualSegmentPlan[] = [...renderSegmentPlans]
    .filter((plan) => plan.contentDurationInFrames > 0)
    .sort((left, right) => left.fromFrame - right.fromFrame)
    .map((plan) => {
      const topicId = plan.renderScene.topic_id;
      const isTopicEntry = !seenTopicEntries.has(topicId);
      if (isTopicEntry) {
        seenTopicEntries.add(topicId);
      }

      const topicSegmentIndex = topicSeenCount.get(topicId) ?? 0;
      topicSeenCount.set(topicId, topicSegmentIndex + 1);

      const topicIndex = topicIndexById.get(topicId) ?? 0;
      const topicCount = topicNodes.length;
      const voiceoverOnly = isVoiceoverOnly(plan);
      const role = deriveRole(
        plan,
        isTopicEntry,
        topicIndex,
        topicSegmentIndex,
        topicCount,
        voiceoverOnly
      );
      const tone = deriveTone(plan, role);
      const layoutMode = deriveLayoutMode(plan, role, voiceoverOnly);
      const plannerTopicLabel =
        topicLabelById.get(topicId) ?? plan.renderScene.title ?? plan.renderScene.topic_id;

      return {
        ...plan,
        renderScene: {
          ...plan.renderScene,
          template_props: {
            ...(plan.renderScene.template_props ?? {}),
            planner_role: role,
            planner_tone: tone,
            planner_layout: layoutMode,
            planner_topic_label: plannerTopicLabel,
            planner_topic_index: topicIndex,
            planner_topic_count: topicCount,
            planner_segment_index_in_topic: topicSegmentIndex,
            planner_is_topic_entry: isTopicEntry,
          },
        },
        topicId,
        topicLabel: plannerTopicLabel,
        topicIndex,
        topicCount,
        topicSegmentIndex,
        isTopicEntry,
        voiceoverOnly,
        role,
        tone,
        layoutMode,
      };
    });

  for (let index = 0; index < segments.length - 1; index++) {
    segments[index].transitionToNext = autoTransitionType(
      segments[index],
      segments[index + 1],
      index
    );
  }

  return {
    segments,
    topicNodes,
    topicAppearances: buildNavAppearances(segments, topicNodes),
  };
}
